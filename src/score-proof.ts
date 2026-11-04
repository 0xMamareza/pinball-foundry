import {keccak256,stringToHex} from 'viem';
import {FIXED_DT,launch,step,type Game,type Input,type Clock} from './engine';
import {TABLES,type Table} from './layout';

export const MAX_PROOF_STEPS=72_000;
// Must match the verifier's pinned engine/layout fingerprint; physics stay in engine.ts.
export const SCORE_RULESET=keccak256(stringToHex('PinballFoundry/replay-v1/3a1306b0d9c803b603d075547c63fa772bf3585da0dd6c4cd8b0280bf19ef495/884ae0c12f64a261447bd786499a494c611495cd031cc8ce189544c1c0d60c52/standard/launch-milli/72000'));
export type ScoreProof={version:1;inputs:number[];launches:{step:number;power:number}[]};
export type Recording={proof:ScoreProof;overflow:boolean};
export function createRecording():Recording{return {proof:{version:1,inputs:[],launches:[]},overflow:false};}
export function officialTable(table:Table){
 const index=TABLES.findIndex(t=>t.title===table.title&&JSON.stringify(t.parts)===JSON.stringify(table.parts));
 if(index<0)return null;
 return {tableId:keccak256(stringToHex(JSON.stringify({ruleset:SCORE_RULESET,parts:TABLES[index].parts,variant:'standard'}))),title:TABLES[index].title,index,variant:'standard' as const,ruleset:SCORE_RULESET};
}
export function recordLaunch(game:Game,record:Recording,power:number){
 if(game.status!=='ready')return;
 const milli=Math.round(Math.max(0,Math.min(1,power))*1000);
 if(!record.overflow)record.proof.launches.push({step:record.proof.inputs.length,power:milli});
 launch(game,milli/1000);
}
export function advanceRecorded(game:Game,input:Input,elapsed:number,clock:Clock,record:Recording){
 clock.accumulator+=Math.max(0,Math.min(.1,elapsed));
 while(clock.accumulator+1e-10>=FIXED_DT){
  if(game.status!=='over'&&!record.overflow){
   if(record.proof.inputs.length===MAX_PROOF_STEPS){record.overflow=true;record.proof={version:1,inputs:[],launches:[]};}
   else record.proof.inputs.push((input.left?1:0)|(input.right?2:0));
  }
  clock.previous={...game.ball};step(game,input);clock.accumulator-=FIXED_DT;
  if(game.status!=='playing')clock.previous={...game.ball};
 }
 return Math.max(0,clock.accumulator/FIXED_DT);
}
export function finishRecording(game:Game,record:Recording):ScoreProof|null{
 if(game.status!=='over'||record.overflow||record.proof.launches.length!==3)return null;
 return {version:1,inputs:[...record.proof.inputs],launches:record.proof.launches.map(a=>({...a}))};
}
