export type SoundCue='launch'|'bumper'|'spinner'|'target'|'charged'|'flipper'|'drain'|'finish';

// Web Audio tones are generated locally: no network asset, autoplay, or music loop.
// One quiet master bus keeps simultaneous pinball impacts below an aggressive mix.
const voice:Record<SoundCue,{pitch:number;end:number;length:number;level:number;wave:OscillatorType}>={
 launch:{pitch:240,end:610,length:.22,level:.16,wave:'triangle'},
 bumper:{pitch:460,end:240,length:.11,level:.11,wave:'sine'},
 spinner:{pitch:710,end:1010,length:.09,level:.075,wave:'triangle'},
 target:{pitch:540,end:330,length:.17,level:.14,wave:'triangle'},
 charged:{pitch:800,end:490,length:.20,level:.16,wave:'sine'},
 flipper:{pitch:180,end:120,length:.055,level:.06,wave:'triangle'},
 drain:{pitch:320,end:95,length:.32,level:.12,wave:'triangle'},
 finish:{pitch:520,end:780,length:.32,level:.12,wave:'sine'},
};

export class ArcadeAudio {
 private context:AudioContext|null=null;
 private master:GainNode|null=null;
 private muted=false;
 private lastFlipper=-Infinity;
 private disposed=false;

 setMuted(muted:boolean){
  this.muted=muted;
  if(this.context&&this.master)this.master.gain.setValueAtTime(muted?0:.32,this.context.currentTime);
 }

 // Call only from a real user gesture. Browsers reject AudioContext.resume otherwise.
 unlock(){
  if(this.muted||this.disposed)return;
  try{
   if(!this.context){
    if(typeof AudioContext==='undefined')return;
    const context=new AudioContext(),master=context.createGain();
    master.gain.value=.32;master.connect(context.destination);
    this.context=context;this.master=master;
   }
   void this.context.resume().catch(()=>{});
  }catch{/* Audio is optional on unsupported browsers. */}
 }

 play(cue:SoundCue){
  if(this.muted||this.disposed||!this.context||!this.master)return;
  try{
   const context=this.context,now=context.currentTime;
   if(cue==='flipper'&&now-this.lastFlipper<.065)return;
   if(cue==='flipper')this.lastFlipper=now;
   const spec=voice[cue],osc=context.createOscillator(),gain=context.createGain();
   osc.type=spec.wave;
   osc.frequency.setValueAtTime(spec.pitch,now);
   osc.frequency.exponentialRampToValueAtTime(spec.end,now+spec.length);
   gain.gain.setValueAtTime(spec.level,now);
   gain.gain.exponentialRampToValueAtTime(.001,now+spec.length);
   osc.connect(gain);gain.connect(this.master);
   osc.onended=()=>{osc.disconnect();gain.disconnect();};
   osc.start(now);osc.stop(now+spec.length+.01);
  }catch{/* A failed audio device must not interrupt a run. */}
 }

 dispose(){
  this.disposed=true;
  const context=this.context;
  this.context=null;this.master=null;
  if(context)void context.close().catch(()=>{});
 }
}
