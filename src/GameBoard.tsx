import { useEffect,useRef,useState } from 'react';
import { createClock,createGame,type Game,type Impact,type Input } from './engine';
import { advanceRecorded,createRecording,recordLaunch,finishRecording,officialTable } from './score-proof';
import ScoreResults,{type FinishedRun} from './ScoreResults';
import type { ArcadeAudio } from './audio';
import { gameSoundCues } from './game-sound';
import { paint } from './paint';
import { TABLES,type Table } from './layout';
import type { Variant } from './settlement';
import { Mascot } from './Mascot';
import {invalidateRankedRun,type RankedTicket} from './ranked-client';

const snapshot=(g:Game)=>({score:g.score,combo:g.combo,lives:g.lives,status:g.status});
type Props={table:Table;variant:Variant;audio:ArcadeAudio;muted:boolean;reduced:boolean;editing?:boolean;selected?:number;onSelect?:(i:number)=>void;onMove?:(i:number,x:number,y:number)=>void;onEdit?:()=>void;onRestart?:()=>void;onStandard?:()=>void;ticket?:RankedTicket|null;practiceOnly?:boolean};
export default function GameBoard({table,variant,audio,muted,reduced,editing=false,selected=-1,onSelect,onMove,onEdit,onRestart,onStandard,ticket=null,practiceOnly=false}:Props){
 const canvas=useRef<HTMLCanvasElement>(null), game=useRef(createGame(table.parts,variant.status==='safe'?variant.palette:null));
 const [hud,setHud]=useState(()=>snapshot(game.current)),[paused,setPaused]=useState(false),[best,setBest]=useState(0);
 const recording=useRef(createRecording()),finished=useRef(false),[result,setResult]=useState<FinishedRun|null>(null),[generation,setGeneration]=useState(0);
 const [runTicket,setRunTicket]=useState(ticket);
 const rankedTable=variant.status==='offline'&&!practiceOnly?officialTable(table):null;
 useEffect(()=>{if(editing){game.current.parts=table.parts;game.current.hits=table.parts.map(()=>-100);}},[table,editing]);
 const keys=useRef(new Set<string>()),pointers=useRef(new Map<number,'left'|'right'>()),charge=useRef<number|null>(null),[charging,setCharging]=useState(false);
 const settings=useRef({paused,muted,reduced});settings.current={paused,muted,reduced};
 const unlockAudio=()=>{audio.unlock();};
 const sync=()=>setHud(snapshot(game.current));
 const shoot=(power=1)=>{if(editing||settings.current.paused||game.current.status!=='ready')return;unlockAudio();recordLaunch(game.current,recording.current,power);audio.play('launch');canvas.current?.closest('.machine-column')?.scrollIntoView?.({block:'start',behavior:'instant'});sync();};
 const restart=()=>{invalidateRankedRun(runTicket);setRunTicket(null);onRestart?.();game.current=createGame(table.parts,variant.status==='safe'?variant.palette:null);recording.current=createRecording();finished.current=false;setResult(null);setGeneration(n=>n+1);setPaused(false);keys.current.clear();pointers.current.clear();charge.current=null;setCharging(false);sync();};
 const clearInput=()=>{keys.current.clear();pointers.current.clear();charge.current=null;setCharging(false);};
 useEffect(()=>{
  const keyDown=(e:KeyboardEvent)=>{
   if((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')||editing)return;
   if(['ArrowLeft','ArrowRight','KeyA','KeyD'].includes(e.code)){e.preventDefault();if(!keys.current.has(e.code)){unlockAudio();audio.play('flipper');}keys.current.add(e.code);}
   if((e.code==='KeyP'||e.code==='Escape')&&!e.repeat){e.preventDefault();clearInput();setPaused(p=>!p);}
   if(e.code==='Space'&&!(e.target as HTMLElement)?.closest('button')){e.preventDefault();if(!e.repeat){charge.current=performance.now();setCharging(true);}}
  };
  const keyUp=(e:KeyboardEvent)=>{keys.current.delete(e.code);if(e.code==='Space'&&charge.current!==null){e.preventDefault();const power=Math.min(1,(performance.now()-charge.current)/700);charge.current=null;setCharging(false);shoot(power);}};
  const leave=()=>{clearInput();if(game.current.status==='playing')setPaused(true);};
  const visibility=()=>{if(document.hidden)leave();};
  window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',leave);document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',leave);document.removeEventListener('visibilitychange',visibility);};
 },[editing,muted]);
 useEffect(()=>{
  const element=canvas.current,c=element?.getContext('2d');if(!element||!c)return;
  const scale=Math.min(window.devicePixelRatio||1,2);element.width=600*scale;element.height=900*scale;c.setTransform(scale,0,0,scale,0,0);
  let frame=0,last=0,previousHud='',lastScore=0,clock=createClock(game.current),lastGame=game.current,previous=snapshot(game.current),notified=new WeakSet<Impact>();
  const tick=(now:number)=>{
   const elapsed=last?Math.min(.1,(now-last)/1000):0;last=now;
   if(lastGame!==game.current){clock=createClock(game.current);lastGame=game.current;lastScore=0;previous=snapshot(game.current);notified=new WeakSet<Impact>();}
   const g=game.current,input:Input={left:keys.current.has('ArrowLeft')||keys.current.has('KeyA')||[...pointers.current.values()].includes('left'),right:keys.current.has('ArrowRight')||keys.current.has('KeyD')||[...pointers.current.values()].includes('right')};
   let alpha=1;
   if(!editing&&!settings.current.paused)alpha=advanceRecorded(g,input,elapsed,clock,recording.current);
   if(!editing&&g.status==='over'&&!finished.current){
    finished.current=true;
    const proof=rankedTable?finishRecording(g,recording.current):null;
    setResult({score:g.score,tableId:rankedTable?.tableId??null,proof,reason:!rankedTable?'Custom, workshop and settlement-charged runs are practice only. Start an official standard run for ranked eligibility.':!proof?'Replay exceeded the 72,000-step limit (10 minutes of simulation). This score is local only.':''});
   }
   const fresh=g.events.filter(event=>!notified.has(event));
   for(const event of fresh)notified.add(event);
   for(const cue of gameSoundCues(previous,g,fresh))audio.play(cue);
   previous=snapshot(g);
   if(g.score>lastScore){lastScore=g.score;setBest(b=>Math.max(b,g.score));}
   const next=JSON.stringify(snapshot(g));if(next!==previousHud){setHud(snapshot(g));previousHud=next;}
   const rendered=editing||settings.current.paused?g:{...g,ball:{...g.ball,x:clock.previous.x+(g.ball.x-clock.previous.x)*alpha,y:clock.previous.y+(g.ball.y-clock.previous.y)*alpha}};
   paint(c,rendered,variant.palette,settings.current.reduced,editing,selected,charge.current===null?0:Math.min(1,(now-charge.current)/700));
   frame=requestAnimationFrame(tick);
  };frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[variant.palette,editing,selected]);
 const drag=useRef<number|null>(null);
 const at=(e:React.PointerEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*600,y:(e.clientY-r.top)/r.height*900};};
 const status=paused?'Paused':hud.status==='playing'?'Ball in play':hud.status==='over'?'Shift complete':'Ready to launch';
 const houseIndex=TABLES.findIndex(t=>t.title===table.title&&JSON.stringify(t.parts)===JSON.stringify(table.parts));
 const plateId=editing?'BLUEPRINT':houseIndex<0?'CUSTOM TABLE':`TABLE ${String(houseIndex+1).padStart(2,'0')}`;
 const flipper=(side:'left'|'right')=><button className={'flipper-control '+side} aria-label={side==='left'?'Left flipper':'Right flipper'}
  onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,side);unlockAudio();audio.play('flipper');}}
  onPointerUp={e=>pointers.current.delete(e.pointerId)} onPointerCancel={e=>pointers.current.delete(e.pointerId)} onLostPointerCapture={e=>pointers.current.delete(e.pointerId)}
  onKeyDown={e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();if(!e.repeat){unlockAudio();audio.play('flipper');}keys.current.add(side==='left'?'ArrowLeft':'ArrowRight');}}}
  onKeyUp={e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();keys.current.delete(side==='left'?'ArrowLeft':'ArrowRight');}}}
  onBlur={()=>{keys.current.delete(side==='left'?'ArrowLeft':'ArrowRight');}} disabled={editing||paused||hud.status==='over'}>
  <span>{side==='left'?'↖':'↗'}</span><strong>{side==='left'?'Left':'Right'}</strong><kbd>{side==='left'?'A / ←':'D / →'}</kbd></button>;
 return <>
  <section className="machine-column" aria-label={editing?'Table editor canvas':'Pinball machine'}>
   <div className="machine-head"><span><i className="status-dot"/> {editing?'WORKSHOP MODE':runTicket?'RANKED · SEPOLIA START CONFIRMED':'FREE PLAY · NO WALLET'}</span><span>EST. 2026</span></div>
   <div className="cabinet">
    <div className="cabinet-title"><span>✦</span><strong>{table.title}</strong><span>✦</span></div>
    <div className="playfield">
     <canvas ref={canvas} width="600" height="900" aria-label={editing?'Select parts in the list or drag them on the table.':'Pinball playfield. Use A and D or arrow keys for flippers; hold and release Space to launch.'} role="img"
      onPointerDown={e=>{if(!editing)return;const p=at(e);const index=table.parts.findIndex(part=>Math.hypot((40+(part.x-28)*2.25)-p.x,(110+(part.y-24)*3.1)-p.y)<34);if(index>=0){onSelect?.(index);drag.current=index;e.currentTarget.setPointerCapture(e.pointerId);}}}
      onPointerMove={e=>{if(!editing||drag.current===null)return;const p=at(e);onMove?.(drag.current,(p.x-40)/2.25+28,(p.y-110)/3.1+24);}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/>
     {!editing&&hud.status!=='playing'&&!paused&&<div className={'playfield-note '+(hud.status==='over'?'game-over':'')}><span>{hud.status==='over'?'NICE SHIFT, MAKER.':'THE WORKSHOP IS YOURS.'}</span><strong>{hud.status==='over'?hud.score.toLocaleString()+' points':'Give it a spin.'}</strong><p>{hud.status==='over'?'Three balls. One beautiful machine.':'Hold Space, then release to launch.'}</p>{hud.status==='over'&&<button onClick={restart}>Play again ↗</button>}</div>}
     {!editing&&paused&&<div className="pause-overlay"><span className="eyebrow">TAKE YOUR TIME</span><strong>Tools down.</strong><p>Your machine is waiting.</p><button className="primary" onClick={()=>setPaused(false)}>Resume game ↗</button></div>}
     {editing&&<div className="editor-note">DRAG PARTS · FINE-TUNE IN THE INSPECTOR</div>}
    </div>
    <div className="cabinet-foot"><span>PF / 001</span><span>MADE OF LITTLE MOMENTS</span><span>◉</span></div>
   </div>
   <div className="machine-floor">
    <div className="machine-plaque" aria-label="Machine details"><span>{plateId}</span><span aria-hidden="true">✦</span><span>{table.parts.length} PARTS</span><span aria-hidden="true">✦</span><span>{editing?'LOCAL DRAFT':'FREE PLAY'}</span></div>
    <svg viewBox="0 0 560 230" preserveAspectRatio="xMidYMin meet" aria-hidden="true" focusable="false" className="floor-schematic">
     <defs><linearGradient id="floor-fade" x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".34"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
     <g fill="none" stroke="url(#floor-fade)" strokeWidth="1.2">
      <path d="M12 46h120l42 36h28M548 46H428l-42 36h-28M24 74h92l36 36h45M536 74h-92l-36 36h-45M41 112h78l30 30h50M519 112h-78l-30 30h-50"/>
      <circle cx="280" cy="119" r="80"/><circle cx="280" cy="119" r="65"/><circle cx="280" cy="119" r="44"/><circle cx="280" cy="119" r="10"/>
      <path d="M280 39v70m0 20v70m-80-80h70m20 0h70m-137-57 50 50m14 14 50 50m0-114-50 50m-14 14-50 50M270 39v-8h20v8M270 207v-8h20v8"/>
      <circle cx="12" cy="46" r="3"/><circle cx="548" cy="46" r="3"/><circle cx="24" cy="74" r="2"/><circle cx="536" cy="74" r="2"/><circle cx="41" cy="112" r="2"/><circle cx="519" cy="112" r="2"/>
     </g>
    </svg>
   </div>
   {!editing&&<><div className="machine-controls">{flipper('left')}<button className={'launch-control '+(charging?'charging':'')} aria-label="Launch ball" disabled={paused||hud.status!=='ready'}
    onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);charge.current=performance.now();setCharging(true);unlockAudio();}}
    onPointerUp={()=>{if(charge.current!==null){const p=Math.min(1,(performance.now()-charge.current)/700);charge.current=null;setCharging(false);shoot(p);}}}
    onPointerCancel={()=>{charge.current=null;setCharging(false);}}
    onClick={()=>shoot(1)}><span>↑</span><strong>{charging?'Charging…':'Launch'}</strong><kbd>SPACE</kbd></button>{flipper('right')}</div>
    <div className="under-controls"><span><i className="status-dot"/> <span role="status">{status}</span></span><div><button aria-label={paused?'Resume game':'Pause game'} onClick={()=>{clearInput();setPaused(p=>!p);}}>{paused?'▷ Resume':'Ⅱ Pause'} <kbd>P</kbd></button><button aria-label="Restart run" onClick={restart}>↻ Restart</button></div></div></>}
  </section>
  {!editing&&<aside className="right-rail">
   <section className="score-panel"><div className="panel-top"><span>YOUR SHIFT</span><span>↗</span></div><span className="score-label">SCORE</span><output aria-label="Score" className="score-value">{String(hud.score).padStart(6,'0')}</output><div className="score-bottom"><div><span>COMBO</span><strong>×{hud.combo}</strong></div><div><span>BALLS LEFT</span><strong aria-label={hud.lives+' balls left'}>{Array.from({length:3},(_,i)=><i key={i} className={i<hud.lives?'ball-token':'ball-token spent'}/>)}</strong></div></div><div className="best-score">SESSION BEST <b>{best.toLocaleString()}</b></div></section>
   <ScoreResults key={generation} ticket={runTicket} result={result} tableId={rankedTable?.tableId??null} title={table.title} onStandard={onStandard}/>
   <section className="field-guide"><span className="eyebrow">THE FIELD GUIDE</span><h3>Find your rhythm.</h3><p>Keep the ball working. Chain hits within 2.5 seconds to build a <b>5× combo.</b></p><ul><li><span className="part-icon bumper-icon">◉</span><div><strong>Wheel bumpers</strong><small>100 points · a little extra kick</small></div></li><li><span className="part-icon spinner-icon">╱</span><div><strong>Spinners</strong><small>150 points · keep it turning</small></div></li><li><span className="part-icon target-icon">◆</span><div><strong>Foundry targets</strong><small>250 points · make it count</small></div></li></ul></section>
   <section className="pip-card"><div className="pip-art"><Mascot/></div><span className="eyebrow">PIP · FLOOR MANAGER</span><p>“A good machine starts<br/>with a little curiosity.”</p><button onClick={onEdit}>Build your own table <span>↗</span></button></section>
   <p className="local-disclaimer">Practice freely. Ranked records automatically.<br/>No tokens or prizes.</p>
  </aside>}
 </>;
}
