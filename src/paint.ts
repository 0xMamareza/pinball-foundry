import { RAILS, flipperSegment, partPosition, type Game } from './engine';

// Original code-drawn workshop art. No external images, NFTs, fonts or asset licenses.
const PALETTES = [ ['#eea266','#77b7a6'], ['#a8cfac','#e2bc79'], ['#a3bfe3','#dba0a0'] ];
function circle(c:CanvasRenderingContext2D,x:number,y:number,r:number,fill:string,stroke?:string,width=1){
 c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
}
function line(c:CanvasRenderingContext2D,coords:number[],color:string,width:number){
 c.beginPath();c.moveTo(coords[0],coords[1]);for(let i=2;i<coords.length;i+=2)c.lineTo(coords[i],coords[i+1]);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();
}
function text(c:CanvasRenderingContext2D,value:string,x:number,y:number,size:number,color:string,font='monospace'){
 c.font=`${size}px ${font}`;c.fillStyle=color;c.textAlign='center';c.fillText(value,x,y);
}
function gear(c:CanvasRenderingContext2D,x:number,y:number,r:number,color:string,rotation=0){
 c.save();c.translate(x,y);c.rotate(rotation);c.beginPath();
 for(let i=0;i<48;i++){const a=i*Math.PI/24,rr=i%4<2?r:r*.85;const x=Math.cos(a)*rr,y=Math.sin(a)*rr;if(i===0)c.moveTo(x,y);else c.lineTo(x,y);}
 c.closePath();c.fillStyle=color;c.fill();circle(c,0,0,r*.65,'#183332');circle(c,0,0,r*.43,color);circle(c,0,0,r*.27,'#183332');c.restore();
}
export function paint(c:CanvasRenderingContext2D,g:Game,palette:number,reduced:boolean,editing=false,selected=-1,power=0){
 const [copper,jade]=PALETTES[palette]||PALETTES[0];
 c.clearRect(0,0,600,900);
 const bg=c.createLinearGradient(0,0,600,900);bg.addColorStop(0,'#254240');bg.addColorStop(.5,'#183432');bg.addColorStop(1,'#122a29');c.fillStyle=bg;c.fillRect(0,0,600,900);
 c.save();c.globalAlpha=.1;
 for(let x=-900;x<600;x+=28)line(c,[x,0,x+900,900],'#c0cdb5',1);
 for(let y=30;y<900;y+=30)for(let x=30;x<600;x+=30)circle(c,x,y,.9,'#f1e0bc');
 c.restore();
 // The cabinet is a tiny machine, with printed circuitry and a warm backglass.
 c.strokeStyle='#4f6961';c.lineWidth=1;c.strokeRect(12,12,576,876);c.strokeRect(18,18,564,864);
 gear(c,105,150,62,'#37514a',-.2);gear(c,442,130,43,'#3b554b',.3);
 line(c,[85,185,85,555,128,592,128,687], '#496451',3);
 line(c,[468,180,468,530,431,572,431,691], '#496451',3);
 for(const x of [85,468])for(const y of [190,530,590])circle(c,x,y,4,'#183432','#708371',1);
 c.save();c.translate(284,482);c.globalAlpha=.24;
 circle(c,-46,-55,25,copper);circle(c,46,-55,25,copper);
 circle(c,-46,-55,14,'#172c29');circle(c,46,-55,14,'#172c29');
 c.beginPath();c.ellipse(0,0,73,77,0,0,Math.PI*2);c.fillStyle=copper;c.fill();
 c.beginPath();c.ellipse(0,27,57,40,0,0,Math.PI*2);c.fillStyle='#d5d6b3';c.fill();
 line(c,[-69,-20,69,-20],'#172c29',16);
 circle(c,-29,-17,21,'#172c29',copper,4);circle(c,29,-17,21,'#172c29',copper,4);
 circle(c,-29,-18,5,'#f0e2c4');circle(c,29,-18,5,'#f0e2c4');
 circle(c,0,27,7,'#172c29');line(c,[0,33,0,43,-10,48],'#172c29',3);line(c,[0,43,10,48],'#172c29',3);
 c.restore();
 text(c,'COPPERWHEEL',284,609,27,'#718476','Georgia');text(c,'PRECISION · PATIENCE · PINBALL',284,635,9,'#91a292');
 text(c,'FOUNDRY No. 01',292,68,11,copper);
 line(c,[195,80,390,80],'#9f8e6d',1);
 text(c,'ONE MORE GOOD SHOT',291,99,8,'#9cac99');
 // Lane lettering and the spring plunger.
 c.save();c.translate(556,480);c.rotate(-Math.PI/2);text(c,'WIND UP  →  LET GO',0,0,10,'#9ca98b');c.restore();
 for(let y=826;y<872;y+=6)line(c,[546,y,565,y+3],copper,2);
 line(c,[541,817+power*12,570,817+power*12], '#e8d1a3',7);
 circle(c,556,882,9,copper,'#172c29',3);
 // Steel rails have a dark seat and a thin light-facing edge.
 RAILS.forEach(s=>{line(c,s,'#0c1d1c',15);line(c,s,'#9f987c',8);line(c,[s[0]-1,s[1]-2,s[2]-1,s[3]-2],'#d6cfad',2);});
 for(const [x,y] of [[24,210],[24,660],[520,210],[520,660],[576,200],[576,810],[155,32],[440,32]]){circle(c,x,y,4,'#d4c5a0');line(c,[x-2,y,x+2,y],'#5e6758',1);}
 // Slingshot inserts; these are decorations inside the physical guide rails.
 for(const side of [0,1]){
  c.save();if(side){c.translate(588,0);c.scale(-1,1);}
  c.beginPath();c.moveTo(67,703);c.lineTo(142,751);c.lineTo(99,782);c.closePath();c.fillStyle=copper;c.fill();c.strokeStyle='#f2d5a6';c.lineWidth=2;c.stroke();
  line(c,[84,721,116,746,104,755],'#653c29',3);c.restore();
 }
 if(editing){
  c.save();c.setLineDash([4,6]);c.strokeStyle='#94bdad';c.lineWidth=2;c.strokeRect(40,110,448,515);c.setLineDash([]);
  for(let y=110;y<=625;y+=24.8)for(let x=40;x<=488;x+=18)circle(c,x,y,1,'#658a78');c.restore();
 }
 g.parts.forEach((part,i)=>{
  const p=partPosition(part),age=g.time-g.hits[i],hit=age<.25;
  c.save();c.translate(p.x,p.y);
  if(hit&&!reduced){c.shadowColor=part.kind===0?copper:jade;c.shadowBlur=30;}
  if(g.energizedBumper===i&&!editing){circle(c,0,0,35,'transparent',jade,3);text(c,'WHEEL CHARGED',0,-42,9,'#fff1c7');}
  if(part.kind===0){
   circle(c,1,5,29,'#0c2221');gear(c,0,0,29,'#8c7450',.12);
   circle(c,0,0,22,'#172f2b','#ead7ad',2);circle(c,0,0,17,hit?'#f9e7ba':copper,'#b17140',2);
   circle(c,0,-1,10,'#ffe1a4');circle(c,0,-3,5,'#fff0c9');
   for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5])circle(c,Math.cos(a)*23,Math.sin(a)*23,2,'#f0e4bd');
  }else if(part.kind===1){
   circle(c,0,0,25,'#102927',jade,1);circle(c,0,0,18,'#2f5147','#9cbf9d',2);
   c.save();c.rotate(hit&&!reduced?age*24:.65);line(c,[-24,0,24,0], '#0c2421',11);line(c,[-22,-1,22,-1],jade,7);circle(c,0,0,6,'#f0dfb8');c.restore();
  }else{
   c.save();c.rotate(Math.PI/4);c.fillStyle='#0d2523';c.fillRect(-20,-16,40,36);c.fillStyle=hit?'#f5edbe':jade;c.fillRect(-17,-17,34,34);c.strokeStyle='#d5e0b5';c.lineWidth=2;c.strokeRect(-13,-13,26,26);c.restore();text(c,'✦',0,6,22,'#25483b');
  }
  c.shadowBlur=0;
  if(editing&&selected===i){circle(c,0,0,34,'transparent','#fff3c5',2);text(c,String(i+1),0,-43,12,'#fff3c5');}
  c.restore();
 });
 // Flipper art is drawn from the exact collision segments.
 for(const side of ['left','right'] as const){
  const s=flipperSegment(side,g[side]);line(c,s,'#0c201e',27);line(c,s,'#c58d5b',21);line(c,[s[0],s[1]-2,s[2],s[3]-2],'#f4d7a4',11);
  circle(c,s[0],s[1],14,'#d69c61','#162e28',3);circle(c,s[0],s[1],5,'#6a6c51');
 }
 text(c,'LEFT',165,860,10,'#a6b59b');text(c,'RIGHT',425,860,10,'#a6b59b');text(c,'↓ DRAIN ↓',294,878,9,'#6d8a77');
 if(!editing){
  const b=g.ball;
  if(!reduced&&g.status==='playing'){line(c,[b.x-b.vx*.028,b.y-b.vy*.028,b.x,b.y],'#bacabb44',8);line(c,[b.x-b.vx*.012,b.y-b.vy*.012,b.x,b.y],'#eff4dc66',5);}
  circle(c,b.x+2,b.y+4,9,'#0a1d1c77');
  const ball=c.createRadialGradient(b.x-3,b.y-4,1,b.x,b.y,9);ball.addColorStop(0,'#fffef2');ball.addColorStop(.45,'#e9f3df');ball.addColorStop(.8,'#94a598');ball.addColorStop(1,'#526b62');circle(c,b.x,b.y,8,ball as unknown as string,'#dce9cf',.7);
  for(const e of g.events){
   const age=g.time-e.time;c.save();c.globalAlpha=Math.max(0,1-age);
   if(!reduced){circle(c,e.x,e.y,25+age*44,'transparent',e.kind===0?copper:jade,2);for(let i=0;i<8;i++){const a=i*Math.PI/4;line(c,[e.x+Math.cos(a)*(30+age*35),e.y+Math.sin(a)*(30+age*35),e.x+Math.cos(a)*(34+age*45),e.y+Math.sin(a)*(34+age*45)],copper,2);}}
   text(c,'+'+e.points,e.x,e.y-37-(reduced?0:age*30),16,'#fff0c5');c.restore();
  }
 }
}
