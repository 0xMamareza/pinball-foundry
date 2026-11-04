import type { Part } from './layout';
export const FIXED_DT = 1 / 120;
export const WIDTH=600, HEIGHT=900, BALL_RADIUS=8;
export type Segment = [number,number,number,number];
export const RAILS:Segment[] = [
  [24,190,24,690],[24,190,55,72],[55,72,140,32],[140,32,450,32],
  [450,32,576,115],[576,115,576,860],[534,180,534,860],[520,180,520,690],
  [24,690,145,768],[520,690,443,768],[80,843,166,788],[495,843,422,788],
];
function collideSegment(b:Ball,s:Segment,r=4): boolean {
  const [x,y,x2,y2]=s, dx=x2-x,dy=y2-y;
  const t=Math.max(0,Math.min(1,((b.x-x)*dx+(b.y-y)*dy)/(dx*dx+dy*dy)));
  let nx=b.x-(x+dx*t),ny=b.y-(y+dy*t);
  const distance=Math.hypot(nx,ny), separation=BALL_RADIUS+r;
  if(distance>=separation) return false;
  if(distance<0.001){nx=-dy;ny=dx;const l=Math.hypot(nx,ny);nx/=l;ny/=l;}else{nx/=distance;ny/=distance;}
  b.x+=nx*(separation-distance); b.y+=ny*(separation-distance);
  const speed=b.vx*nx+b.vy*ny;
  if(speed<0){b.vx-=1.8*speed*nx;b.vy-=1.8*speed*ny;}
  return true;
}
export function partPosition(p:Pick<Part,'x'|'y'>) { return {x:40+(p.x-28)*2.25,y:110+(p.y-24)*3.1}; }
export function gridPosition(x:number,y:number) { return {x:Math.max(28,Math.min(227,Math.round((x-40)/2.25+28))),y:Math.max(24,Math.min(190,Math.round((y-110)/3.1+24)))}; }
export function flipperSegment(side:'left'|'right',amount:number):Segment {
  const angle=.36-amount*.78, x=side==='left'?157:431, direction=side==='left'?1:-1;
  return [x,770,x+direction*Math.cos(angle)*112,770+Math.sin(angle)*112];
}
export type Input = {left:boolean;right:boolean};
export type Ball = {x:number;y:number;vx:number;vy:number};
export type Game = {parts:Part[];ball:Ball;lives:number;status:'ready'|'playing'|'over';score:number;combo:number;time:number;lastHit:number;hits:number[];left:number;right:number;events:Impact[];energizedBumper:number|null};
export type Impact = {x:number;y:number;points:number;kind:number;time:number};
export type Clock={accumulator:number;previous:Ball};
export function createClock(g:Game):Clock{return {accumulator:0,previous:{...g.ball}};}
export function advanceGame(g:Game,input:Input,elapsed:number,clock:Clock):number {
  clock.accumulator+=Math.max(0,Math.min(.1,elapsed));
  while(clock.accumulator+1e-10>=FIXED_DT){
    clock.previous={...g.ball};step(g,input);clock.accumulator-=FIXED_DT;
    if(g.status!=='playing')clock.previous={...g.ball};
  }
  return Math.max(0,clock.accumulator/FIXED_DT);
}
export function createGame(parts:Part[], settledLane:number|null=null): Game {
  const bumpers=parts.flatMap((part,index)=>part.kind===0?[index]:[]);
  const energizedBumper=settledLane===null||!bumpers.length?null:bumpers[settledLane%bumpers.length];
  return {parts:parts.map(p=>({...p})),ball:{x:556,y:790,vx:0,vy:0},lives:3,status:'ready',score:0,combo:1,time:0,lastHit:-100,hits:parts.map(()=>-100),left:0,right:0,events:[],energizedBumper};
}
export function launch(g:Game,power:number) {
  if (g.status !== 'ready') return;
  g.status='playing';
  g.ball.vy=-(1040+Math.max(0,Math.min(1,power))*260);
}
export function step(g:Game,input:Input) {
  const previousLeft=g.left,previousRight=g.right;
  g.left+=Math.max(-.18,Math.min(.24,(input.left?1:0)-g.left));
  g.right+=Math.max(-.18,Math.min(.24,(input.right?1:0)-g.right));
  if(g.status!=='playing') return;
  g.time+=FIXED_DT;
  g.ball.vy+=540*FIXED_DT;
  // At 120 Hz, the cap keeps travel below the ball radius + thinnest rail radius.
  const initialSpeed=Math.hypot(g.ball.vx,g.ball.vy);
  if(initialSpeed>1350){g.ball.vx*=1350/initialSpeed;g.ball.vy*=1350/initialSpeed;}
  g.ball.x+=g.ball.vx*FIXED_DT;
  g.ball.y+=g.ball.vy*FIXED_DT;
  for (const rail of RAILS) collideSegment(g.ball,rail);
  for(const side of ['left','right'] as const){
    const previous=side==='left'?previousLeft:previousRight;
    if(collideSegment(g.ball,flipperSegment(side,g[side]),10) && g[side]>previous){
      g.ball.vy=-740;g.ball.vx+=(side==='left'?1:-1)*160;
    }
  }
  g.parts.forEach((part,index)=>{
    const p=partPosition(part),dx=g.ball.x-p.x,dy=g.ball.y-p.y,d=Math.hypot(dx,dy),radius=part.kind===0?17:15;
    if(d>=radius+BALL_RADIUS) return;
    const nx=d>.001?dx/d:0,ny=d>.001?dy/d:-1;
    g.ball.x=p.x+nx*(radius+BALL_RADIUS+.1);g.ball.y=p.y+ny*(radius+BALL_RADIUS+.1);
    const dot=g.ball.vx*nx+g.ball.vy*ny;
    if(dot<0){g.ball.vx-=2*dot*nx;g.ball.vy-=2*dot*ny;}
    const charged=index===g.energizedBumper;
    g.ball.vx+=nx*(charged?280:part.kind===0?190:100);g.ball.vy+=ny*(charged?280:part.kind===0?190:100);
    if(g.time-g.hits[index]<.18) return;
    g.combo=g.time-g.lastHit<2.5?Math.min(5,g.combo+1):1;
    const points=([100,150,250][part.kind]+(charged?125:0))*g.combo;
    g.score+=points;g.lastHit=g.time;g.hits[index]=g.time;
    g.events.push({x:p.x,y:p.y,points,kind:part.kind,time:g.time});
  });
  if(g.time-g.lastHit>2.5) g.combo=1;
  g.events=g.events.filter(e=>g.time-e.time<1);
  const speed=Math.hypot(g.ball.vx,g.ball.vy);
  if(speed>1350){g.ball.vx*=1350/speed;g.ball.vy*=1350/speed;}
  if(g.ball.y>920){
    g.lives--;g.combo=1;g.events=[];
    g.status=g.lives>0?'ready':'over';
    g.ball={x:556,y:790,vx:0,vy:0};
  }
}
