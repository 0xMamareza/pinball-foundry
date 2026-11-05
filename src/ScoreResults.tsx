import {useEffect,useRef,useState} from 'react';
import {submitRankedScore,readRankedLeaderboard,type RankedTicket,type RecordedScore} from './ranked-client';
import type {Hex} from 'viem';
import type {ScoreProof} from './score-proof';
export type FinishedRun={score:number;tableId:Hex|null;proof:ScoreProof|null;reason:string};
export default function ScoreResults({result,tableId,title,onStandard,ticket=null}:{result:FinishedRun|null;tableId:Hex|null;title:string;onStandard?:()=>void;ticket?:RankedTicket|null}){
 const [record,setRecord]=useState<'pending'|'recorded'|'failed'>('pending'),[recordError,setRecordError]=useState(''),[attempt,setAttempt]=useState(0),[leaders,setLeaders]=useState<RecordedScore[]|null>(null),[leaderError,setLeaderError]=useState('');
 useEffect(()=>{if(!ticket||!result)return;let active=true;setRecord('pending');setRecordError('');if(!result.proof||result.tableId!==ticket.tableId){setRecord('failed');setRecordError('This replay is not eligible for the ranked start.');return;}submitRankedScore(ticket,result.score,result.proof).then(()=>{if(!active)return;setRecord('recorded');readRankedLeaderboard(ticket.tableId,ticket.config).then(rows=>{if(active){setLeaders(rows);setLeaderError('');}},()=>{if(active)setLeaderError('Score saved, but the leaderboard could not be refreshed. No rank is claimed.');});},()=>{if(active){setRecord('failed');setRecordError('Recording could not be confirmed. Your local score is preserved; do not send another wallet transaction.');}});return()=>{active=false;};},[ticket,result,attempt]);
 const [shareStatus,setShareStatus]=useState(''),[copyFallback,setCopyFallback]=useState(false);
 const fallbackRef=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{if(copyFallback){fallbackRef.current?.focus();fallbackRef.current?.select();}},[copyFallback]);
 const text=result?`I scored ${result.score.toLocaleString()} points on ${tableId?title:'a custom table'} in Squeek Pinball. Your shift next?`:'';
 const copy=async()=>{try{if(!navigator.clipboard)throw Error();await navigator.clipboard.writeText(text);setShareStatus('Result copied.');setCopyFallback(false);}catch{setShareStatus('Select the result text below to copy.');setCopyFallback(true);}};
 const share=async()=>{try{await navigator.share({title:'Squeek Pinball · shift complete',text});setShareStatus('Share sheet opened.');}catch(error){if((error as Error).name!=='AbortError')setShareStatus('Sharing unavailable. Try Copy result instead.');}};
 return <section className="leaderboard-panel result-card" aria-label="Final score and sharing">
  <div className="panel-top"><span>{result?'YOUR SHIFT RECEIPT':'PLAY FIRST. FIND YOUR RHYTHM.'}</span><span>✦</span></div>
  {result?<><div className="result-seal" aria-hidden="true">✳</div><h3>Shift complete</h3><output className="final-score" aria-label="Final local score">{result.score.toLocaleString()}</output><span className="result-points">POINTS · {title}</span>
   <div className="record-state" role="status"><b>{ticket?(record==='pending'?'Pending · verifying replay':record==='recorded'?'Recorded · offchain leaderboard':'Unable to record'):'Practice · local result'}</b><p>{ticket?(record==='pending'?'Automatically replaying your finished run. No wallet action needed.':record==='recorded'?'Replay verified and exact saved result read back. Your score is offchain, not on Ethereum.':recordError):'Not sent to the leaderboard. Start a ranked run before play to record a replay-verified score.'}</p></div>
   {ticket&&record==='failed'&&result.proof&&<button onClick={()=>setAttempt(n=>n+1)}>Retry recording · no wallet</button>}
   {ticket&&record!=='recorded'&&<p className="small-note">Your private replay is kept only in this tab’s memory for retry. Reloading, restarting or leaving discards it. Never share a replay authorization or nonce.</p>}
   {result.reason&&<p className="score-eligibility">{result.reason}</p>}
   {leaders!==null&&<><h4>OFFCHAIN · {title} · TOP 20</h4>{leaders.length?<ol className="leaderboard-list">{leaders.map((row,i)=><li key={row.wallet}><span>#{i+1}</span><abbr title={row.wallet}>{row.wallet.slice(0,6)}…{row.wallet.slice(-4)}</abbr><b>{row.score.toLocaleString()}</b></li>)}</ol>:<p>No leaderboard entries were returned. No rank is claimed.</p>}</>}
   {leaderError&&<p role="status">{leaderError}</p>}
   {result.proof&&<p className="small-note">Replay saved for this result ({result.proof.inputs.length.toLocaleString()} fixed steps). Restarting or leaving this table discards it.</p>}
   <div className="share-actions"><a aria-label="Share on X" href={'https://twitter.com/intent/tweet?'+new URLSearchParams({text})} target="_blank" rel="noopener noreferrer">Share on X ↗</a><a aria-label="Share on Telegram" href={'https://t.me/share/url?'+new URLSearchParams({url:'',text})} target="_blank" rel="noopener noreferrer">Telegram ↗</a><button onClick={copy}>Copy result</button>{typeof navigator.share==='function'&&<button onClick={share}>More sharing options</button>}</div><p className="share-copy">A good shift is worth sharing. Only if you want to.</p><p role="status">{shareStatus}</p>{copyFallback&&<textarea ref={fallbackRef} aria-label="Select result text to copy" readOnly value={text} style={{width:'100%',minHeight:70}}/>}
  </>:<p>Finish all three balls to see your score and optional sharing. Practice scores are local to this run and disappear when you leave or restart. Ranked runs are recorded offchain automatically after replay verification.</p>}
  {!tableId&&onStandard&&<button className="full" onClick={onStandard}>Start official standard run ↗</button>}
  <p className="small-note">No post-game wallet transaction. Replay verification is not proof of human play. No tokens or prizes.</p>
 </section>;
}
