import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,act} from '@testing-library/react';
import GameBoard from './GameBoard';
import {TABLES} from './layout';
import {OFFLINE_VARIANT} from './settlement';
import {ArcadeAudio} from './audio';
import {connectWallet} from './chain';
vi.mock('./paint',()=>({paint:vi.fn()}));
vi.mock('./chain',async()=>({...await vi.importActual('./chain'),connectWallet:vi.fn()}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('retains an actual finished replay and clears it on restart without ever asking for a wallet mid-game',()=>{
 let callback:FrameRequestCallback=()=>{},time=1;
 vi.stubGlobal('requestAnimationFrame',vi.fn((f:FrameRequestCallback)=>{callback=f;return 1;}));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({setTransform:vi.fn()} as never);
 Element.prototype.scrollIntoView=vi.fn();
 render(<GameBoard table={TABLES[0]} variant={OFFLINE_VARIANT} audio={new ArcadeAudio()} muted={true} reduced={true}/>);
 expect(screen.queryByLabelText('Final local score')).toBeNull();
 for(let ball=0;ball<3;ball++){
  fireEvent.click(screen.getByRole('button',{name:'Launch ball'}));
  for(let frame=0;frame<40;frame++){
   act(()=>{for(let i=0;i<100;i++){time+=100;callback(time);}});
   if(screen.queryByText('Ready to launch')||screen.queryByRole('heading',{name:'Shift complete'}))break;
  }
 }
 expect(Number(screen.getByLabelText('Final local score').textContent?.replaceAll(',',''))).toBeGreaterThan(0);
 expect(screen.getByText(/Replay saved for this result/)).toBeTruthy();
 expect(connectWallet).not.toHaveBeenCalled();
 for(let i=0;i<5;i++)act(()=>{time+=100;callback(time);});
 expect(screen.getByRole('heading',{name:'Shift complete'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Restart run'}));
 expect(screen.queryByLabelText('Final local score')).toBeNull();
 expect(screen.queryByText(/Replay saved for this result/)).toBeNull();
});
