import {expect,it} from 'vitest';
import { addPart, movePart, removePart, saveLocal, loadLocal } from './editor';
import { TABLES } from './layout';
it('adds a legal part, constrains moves, rejects overlap and prevents deleting below three',()=>{
 const t=TABLES[0], next=addPart(t,2);
 expect(next.parts.length).toBe(t.parts.length+1);expect(t.parts.length).toBe(8);
 expect(movePart(t,0,0,999).parts[0]).toEqual({kind:0,x:28,y:190});
 expect(()=>movePart(t,0,t.parts[1].x,t.parts[1].y)).toThrow(/overlap/);
 expect(removePart(t,0).parts.length).toBe(7);
 expect(()=>removePart({...t,parts:t.parts.slice(0,3)},0)).toThrow();
 expect(()=>addPart({...t,parts:Array.from({length:12},(_,i)=>({kind:0,x:28+i*17,y:24}))},0)).toThrow();
});
it('stores versioned layouts and refuses corrupt or newer saves without replacing them',()=>{
 localStorage.clear();expect(loadLocal(localStorage)).toBeNull();
 saveLocal(localStorage,TABLES[1]);expect(loadLocal(localStorage)).toEqual(TABLES[1]);
 localStorage.setItem('pinball-foundry.layout.v1','{"version":99}');
 expect(()=>loadLocal(localStorage)).toThrow(/version/);
 expect(localStorage.getItem('pinball-foundry.layout.v1')).toBe('{"version":99}');
});
