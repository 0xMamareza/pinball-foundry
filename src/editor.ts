import {parseTable,validateLayout,type Part,type Table} from './layout';
const KEY='pinball-foundry.layout.v1';
function checked(t:Table):Table {
 const errors=validateLayout(t.parts);if(errors.length)throw Error(errors[0]);return t;
}
export function addPart(t:Table,kind:Part['kind']):Table {
 if(t.parts.length>=12)throw Error('Maximum 12 parts. Remove one first.');
 for(let y=42;y<=184;y+=24)for(let x=52;x<=220;x+=24){
   if(t.parts.every(p=>Math.hypot(p.x-x,p.y-y)>=20))return checked({...t,parts:[...t.parts,{kind,x,y}]});
 }
 throw Error('No free space. Move a part first.');
}
export function movePart(t:Table,index:number,x:number,y:number):Table {
 if(!t.parts[index] || !Number.isFinite(x) || !Number.isFinite(y))throw Error('Invalid part position.');
 return checked({...t,parts:t.parts.map((p,i)=>i===index?{...p,x:Math.max(28,Math.min(227,Math.round(x))),y:Math.max(24,Math.min(190,Math.round(y)))}:p)});
}
export function removePart(t:Table,index:number):Table {return checked({...t,parts:t.parts.filter((_,i)=>i!==index)});}
export function saveLocal(storage:Storage,t:Table):void {const valid=parseTable(JSON.stringify(t));storage.setItem(KEY,JSON.stringify(valid));}
export function loadLocal(storage:Storage):Table|null {const raw=storage.getItem(KEY);return raw?parseTable(raw):null;}
