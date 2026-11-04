import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,cleanup} from '@testing-library/react';
import App from './App';

vi.mock('./chain',async()=>({...await vi.importActual('./chain'),isRegistryConfigured:()=>false,connectWallet:vi.fn(),publishTable:vi.fn(),listTables:vi.fn()}));
const started=vi.fn(),resumed=vi.fn(async()=>{});
class FakeContext {
 currentTime=1;destination={};
 resume=resumed;close=vi.fn(async()=>{});
 createGain(){return {gain:{value:1,setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};}
 createOscillator(){return {frequency:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn(),start:started,stop:vi.fn(),onended:null};}
}
beforeEach(()=>{localStorage.clear();history.replaceState(null,'','/');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('offline')));vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());vi.stubGlobal('AudioContext',FakeContext);vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();started.mockClear();resumed.mockClear();});
it('sound defaults on and a launch gesture unlocks audio and plays a cue',()=>{
 render(<App/>);
 expect(screen.getByRole('button',{name:'Mute sound'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Launch ball'}));
 expect(resumed).toHaveBeenCalled();expect(started).toHaveBeenCalled();
});
it('pressing a flipper triggers a distinct short sound',()=>{
 render(<App/>);
 fireEvent.keyDown(document.body,{code:'ArrowLeft'});
 expect(started).toHaveBeenCalledOnce();
});
it('the mute control prevents subsequent gameplay cues',()=>{
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Mute sound'}));
 expect(screen.getByRole('button',{name:'Unmute sound'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Launch ball'}));
 expect(started).not.toHaveBeenCalled();
});
