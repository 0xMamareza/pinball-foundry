import {expect,it} from 'vitest';
import {createGame,partPosition} from './engine';
import {TABLES} from './layout';
import {gameSoundCues} from './game-sound';

it('maps each impact to its own sound, including a charged bumper',()=>{
 const g=createGame(TABLES[0].parts,0);
 const bumper=g.parts[g.energizedBumper!],at=partPosition(bumper);
 const impacts=[{...at,kind:0,points:225,time:1},{x:0,y:0,kind:1,points:150,time:1},{x:0,y:0,kind:2,points:250,time:1}];
 expect(gameSoundCues({lives:3,status:'playing'},g,impacts)).toEqual(['charged','spinner','target']);
 g.energizedBumper=null;
 expect(gameSoundCues({lives:3,status:'playing'},g,impacts)).toEqual(['bumper','spinner','target']);
});
it('plays drain on lost ball and finish after last ball',()=>{
 const g=createGame(TABLES[0].parts);
 g.lives=2;g.status='ready';
 expect(gameSoundCues({lives:3,status:'playing'},g,[])).toEqual(['drain']);
 g.lives=0;g.status='over';
 expect(gameSoundCues({lives:1,status:'playing'},g,[])).toEqual(['drain','finish']);
});