import {afterEach,expect,it,vi} from 'vitest';
import {ArcadeAudio,type SoundCue} from './audio';

const oscillators: Array<{frequency:{setValueAtTime:ReturnType<typeof vi.fn>;exponentialRampToValueAtTime:ReturnType<typeof vi.fn>};start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;onended:(()=>void)|null}> = [];
const gains: Array<{gain:{value:number;setValueAtTime:ReturnType<typeof vi.fn>;exponentialRampToValueAtTime:ReturnType<typeof vi.fn>};connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}> = [];
const resume=vi.fn(async()=>{}),close=vi.fn(async()=>{});
class FakeContext {
 currentTime=1;
 state='suspended';
 destination={};
 resume=resume;
 close=close;
 createGain(){const node={gain:{value:1,setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};gains.push(node);return node;}
 createOscillator(){const node={frequency:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},start:vi.fn(),stop:vi.fn(),connect:vi.fn(),disconnect:vi.fn(),onended:null as (()=>void)|null};oscillators.push(node);return node;}
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();oscillators.length=0;gains.length=0;});
it('does not create audio before a gesture or when muted; unmute and unlock enable sound',()=>{
 vi.stubGlobal('AudioContext',FakeContext);const audio=new ArcadeAudio();
 audio.play('launch');expect(gains).toHaveLength(0);
 audio.setMuted(true);audio.unlock();audio.play('bumper');expect(gains).toHaveLength(0);
 audio.setMuted(false);audio.unlock();audio.play('launch');expect(resume).toHaveBeenCalledOnce();expect(oscillators.length).toBeGreaterThan(0);
 audio.setMuted(true);const before=oscillators.length;audio.play('target');expect(oscillators).toHaveLength(before);expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0,1);
});
it('offers distinguishable launch, bumper, spinner, target, flipper, drain and finish cues and rate-limits repeated flippers',()=>{
 vi.stubGlobal('AudioContext',FakeContext);const audio=new ArcadeAudio();audio.unlock();
 const cues:SoundCue[]=['launch','bumper','spinner','target','flipper','drain','finish'];
 for(const cue of cues)audio.play(cue);
 const pitches=oscillators.map(o=>o.frequency.setValueAtTime.mock.calls[0]?.[0]);
 expect(new Set(pitches).size).toBeGreaterThanOrEqual(5);
 expect(oscillators.every(o=>o.stop.mock.calls.length>0)).toBe(true);
 const count=oscillators.length;audio.play('flipper');expect(oscillators).toHaveLength(count);
});
it('fails silently without Web Audio and closes the context on disposal',async()=>{
 vi.stubGlobal('AudioContext',undefined);const absent=new ArcadeAudio();expect(()=>{absent.unlock();absent.play('drain');absent.dispose();}).not.toThrow();
 vi.stubGlobal('AudioContext',FakeContext);const active=new ArcadeAudio();active.unlock();active.play('target');oscillators[0].onended?.();expect(oscillators[0].disconnect).toHaveBeenCalled();await active.dispose();expect(close).toHaveBeenCalledOnce();
});
