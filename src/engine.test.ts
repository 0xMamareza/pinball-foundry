import { expect, it } from 'vitest';
import { createGame, step, launch, FIXED_DT, partPosition, flipperSegment, createClock, advanceGame } from './engine';
import { TABLES } from './layout';

it('rebounds from walls and routes a plunger shot out of the launch lane', () => {
  const g=createGame(TABLES[0].parts); launch(g,1);
  g.ball={x:33,y:450,vx:-300,vy:0}; step(g,{left:false,right:false});
  expect(g.ball.vx).toBeGreaterThan(0);
  const shot=createGame(TABLES[0].parts); launch(shot,1);
  for(let i=0;i<150;i++) step(shot,{left:false,right:false});
  expect(shot.ball.x).toBeLessThan(525);
  expect(Number.isFinite(shot.ball.y)).toBe(true);
});

it('drains exactly one life, waits for launch and ends after three drains', () => {
  const g=createGame(TABLES[0].parts);
  for(let lives=2;lives>=0;lives--) {
    launch(g,1);g.ball={x:300,y:920,vx:0,vy:200};step(g,{left:false,right:false});
    expect(g.lives).toBe(lives);
    expect(g.status).toBe(lives?'ready':'over');
    step(g,{left:false,right:false});expect(g.lives).toBe(lives);
  }
  launch(g,1);expect(g.status).toBe('over');
});

it('scores distinct part impacts with a timed, capped combo and hit cooldown', () => {
  const g=createGame(TABLES[0].parts);launch(g,1);
  const hit=(index:number)=>{const p=partPosition(g.parts[index]);g.ball={x:p.x,y:p.y-23,vx:0,vy:200};step(g,{left:false,right:false});};
  hit(0);expect(g.score).toBe(100);expect(g.events.length).toBe(1);
  hit(0);expect(g.score).toBe(100);
  hit(1);expect(g.combo).toBe(2);expect(g.score).toBe(300);
  expect(g.ball.vy).toBeLessThan(0);
  g.time+=4;hit(0);expect(g.combo).toBe(1);expect(g.score).toBe(400);
});

it('left and right flippers independently move and kick the ball upward', () => {
  for(const side of ['left','right'] as const){
    const g=createGame(TABLES[0].parts);launch(g,1);
    const before=flipperSegment(side,0);
    g.ball={x:side==='left'?245:343,y:794,vx:0,vy:180};
    step(g,{left:side==='left',right:side==='right'});
    expect(g[side]).toBeGreaterThan(0);
    expect(flipperSegment(side,g[side])).not.toEqual(before);
    expect(g.ball.vy).toBeLessThan(-400);
  }
});

it('caps fast balls before integration so a thin rail cannot be tunneled through',()=>{
 const g=createGame(TABLES[0].parts);launch(g,1);g.ball={x:40,y:450,vx:-15000,vy:0};
 step(g,{left:false,right:false});expect(g.ball.x).toBeGreaterThanOrEqual(36);expect(g.ball.vx).toBeGreaterThan(0);
 expect(Math.hypot(g.ball.vx,g.ball.vy)).toBeLessThanOrEqual(1350.001);
});
it('has identical simulation at 30 and 144 render fps and bounds a long stall',()=>{
 const games=[30,144].map(fps=>{const g=createGame(TABLES[0].parts),clock=createClock(g);launch(g,1);for(let i=0;i<fps*2;i++)advanceGame(g,{left:false,right:false},1/fps,clock);return g;});
 expect(games[0]).toEqual(games[1]);
 const g=createGame(TABLES[0].parts),clock=createClock(g);launch(g,1);advanceGame(g,{left:false,right:false},100,clock);expect(g.time).toBeLessThanOrEqual(.101);
});

it('starts with three balls and a stationary ball in the launch lane; launch only fires once', () => {
  const g = createGame(TABLES[0].parts);
  expect(g.lives).toBe(3);
  expect(g.status).toBe('ready');
  step(g, {left:false,right:false});
  expect(g.ball.y).toBe(790);
  launch(g,1);
  expect(g.status).toBe('playing');
  expect(g.ball.vy).toBeLessThan(-900);
  const vy=g.ball.vy;
  launch(g,1);
  expect(g.ball.vy).toBe(vy);
  step(g,{left:false,right:false});
  expect(g.ball.y).toBeLessThan(790);
  expect(g.ball.vy).toBeGreaterThan(vy);
  expect(FIXED_DT).toBe(1/120);
});

it('energizes one bumper from a safe round and keeps its extra kick and points fixed for a run', () => {
  const parts=TABLES[0].parts;
  const normal=createGame(parts), charged=createGame(parts,1);
  expect(charged.energizedBumper).toBe(1);
  launch(normal,1);launch(charged,1);
  const p=partPosition(parts[1]);
  normal.ball={x:p.x,y:p.y-23,vx:0,vy:200};
  charged.ball={...normal.ball};
  step(normal,{left:false,right:false});step(charged,{left:false,right:false});
  expect(normal.score).toBe(100);
  expect(charged.score).toBe(225);
  expect(charged.ball.vy).toBeLessThan(normal.ball.vy);
  expect(charged.energizedBumper).toBe(1);
});
