import {expect,it} from 'vitest';

it('bounds recording memory, rejects incomplete runs and never mistakes custom tables for official',()=>{
 const game=createGame(TABLES[0].parts),record=createRecording(),clock=createClock(game);
 expect(finishRecording(game,record)).toBeNull();
 expect(officialTable({...TABLES[0],parts:TABLES[0].parts.map((p,i)=>({...p,x:p.x+(i?0:1)}))})).toBeNull();
 expect(officialTable({...TABLES[0],title:'Custom'})).toBeNull();
 for(let i=0;i<MAX_PROOF_STEPS/12+1;i++)advanceRecorded(game,{left:i%2===0,right:false},.1,clock,record);
 expect(record.overflow).toBe(true);expect(record.proof.inputs).toHaveLength(0);
 recordLaunch(game,record,.4);expect(record.proof.launches).toHaveLength(0);
 expect(createRecording().proof.inputs).toHaveLength(0);
});
import {advanceGame,createClock,createGame,launch} from './engine';
import {TABLES} from './layout';
import {advanceRecorded,createRecording,recordLaunch,finishRecording,officialTable,MAX_PROOF_STEPS} from './score-proof';
import {officialTables,replay} from '../verifier/src/replay';

it('records exactly the fixed ticks and milli-power consumed by a real completed game',()=>{
 const game=createGame(TABLES[0].parts),record=createRecording(),clock=createClock(game);
 const reference=createGame(TABLES[0].parts),referenceClock=createClock(reference);
 let frames=0;
 while(game.status!=='over'&&frames++<20000){
  if(game.status==='ready'){recordLaunch(game,record,.73456);launch(reference,.735);}
  const input={left:false,right:false},elapsed=[1/60,1/144,.023][frames%3];
  advanceRecorded(game,input,elapsed,clock,record);advanceGame(reference,input,elapsed,referenceClock);
  expect(game).toEqual(reference);
 }
 expect(game.status).toBe('over');expect(game.score).toBeGreaterThan(0);
 const proof=finishRecording(game,record)!;
 expect(proof.launches).toHaveLength(3);expect(proof.launches[0].power).toBe(735);
 expect(officialTable(TABLES[0])).toEqual(officialTables()[0]);
 expect(replay(officialTables()[0].tableId,'standard',proof).score).toBe(game.score);
 const count=proof.inputs.length;
 advanceRecorded(game,{left:true,right:true},.1,clock,record);
 expect(finishRecording(game,record)?.inputs).toHaveLength(count);
});
