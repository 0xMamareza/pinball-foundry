import {useState} from 'react';
import './landing.css';

type Props = {onPlay:()=>void; onWorkshop:()=>void; onConnect:()=>void; walletStatus:string; walletConnected:boolean; walletBusy:boolean};

// Original circuit-wheel study: Pip's ears, a bumper and a pair of copper flippers.
function CircuitSculpture(){
 return <svg className="circuit-sculpture" viewBox="0 0 760 470" fill="none" aria-hidden="true">
  <defs>
   <linearGradient id="copper" x1="180" y1="70" x2="520" y2="410" gradientUnits="userSpaceOnUse"><stop stopColor="#f5d4aa"/><stop offset=".32" stopColor="#b9764e"/><stop offset=".56" stopColor="#e6ad78"/><stop offset="1" stopColor="#75452f"/></linearGradient>
   <linearGradient id="wheel" x1="280" y1="100" x2="490" y2="390" gradientUnits="userSpaceOnUse"><stop stopColor="#38574a"/><stop offset="1" stopColor="#10251f"/></linearGradient>
   <radialGradient id="steel" cx=".32" cy=".25"><stop stopColor="#fff9e8"/><stop offset=".24" stopColor="#d7e5d9"/><stop offset=".55" stopColor="#6e9182"/><stop offset=".84" stopColor="#1c3930"/><stop offset="1" stopColor="#a7ba9e"/></radialGradient>
   <pattern id="grooves" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0h6" stroke="#e5ba8c" strokeOpacity=".18"/></pattern>
  </defs>
  <g stroke="currentColor" strokeWidth="1" opacity=".3"><path d="M32 96h109l29 29h69M17 354h151l32-32h65M501 139h81l42-42h94M501 348h107l35 35h81"/><circle cx="32" cy="96" r="4"/><circle cx="17" cy="354" r="4"/><circle cx="718" cy="97" r="4"/><circle cx="724" cy="383" r="4"/><path d="M378 10v52m0 352v46M92 235h66m406 0h104" strokeDasharray="3 6"/><ellipse cx="378" cy="243" rx="305" ry="163" transform="rotate(-19 378 243)"/></g>
  <ellipse cx="388" cy="407" rx="211" ry="22" fill="#061410" opacity=".3"/>
  <g className="sculpture-wheel">
   <path d="M263 150c-79-10-91-98-41-115 44-15 79 30 71 70m163 45c79-10 91-98 41-115-44-15-79 30-71 70" fill="url(#wheel)" stroke="url(#copper)" strokeWidth="8"/>
   <path d="M258 113c-38-12-46-48-26-54 21-7 38 21 35 36m193 18c38-12 46-48 26-54-21-7-38 21-35 36" stroke="#9ac5ab" strokeOpacity=".5" strokeWidth="2"/>
   <circle cx="365" cy="239" r="165" fill="#0c211a" stroke="url(#copper)" strokeWidth="3"/>
   <circle cx="365" cy="234" r="154" fill="url(#wheel)" stroke="url(#copper)" strokeWidth="14"/>
   <circle cx="365" cy="234" r="138" stroke="#a7c4a4" strokeOpacity=".35" strokeDasharray="1 10" strokeWidth="7"/>
   <circle cx="365" cy="234" r="121" fill="url(#grooves)" stroke="#c38e62" strokeOpacity=".5"/>
   {[0,60,120,180,240,300].map(angle=><g key={angle} transform={`rotate(${angle} 365 234)`}><path d="M365 107v48m-6-43h12m-12 9h12m-12 9h12" stroke="#9db8a0" strokeOpacity=".45"/><circle cx="365" cy="116" r="4" fill="url(#copper)"/></g>)}
   <circle cx="365" cy="234" r="77" fill="#112a21" stroke="url(#copper)" strokeWidth="8"/>
   <circle cx="365" cy="234" r="64" stroke="#96b89b" strokeOpacity=".5"/>
   <path d="M325 222h30m20 0h30m-50 0 10 10 10-10m-10 10v17m-15 0c6 15 24 15 30 0" stroke="url(#copper)" strokeWidth="5" strokeLinecap="round"/>
   <path d="m310 251 24-3m62 0 24 3m-112 10 26-3m62 0 26 3" stroke="#9bc3a4" strokeWidth="2"/>
   <path d="m286 354 47 20c14 6 8 24-6 22l-63-10c-27-4-11-44 22-32Zm158 0-47 20c-14 6-8 24 6 22l63-10c27-4 11-44-22-32Z" fill="url(#copper)" stroke="#e9c295" strokeWidth="1.5"/>
   <circle cx="276" cy="370" r="5" fill="#1c372b"/><circle cx="454" cy="370" r="5" fill="#1c372b"/>
  </g>
  <path d="M520 337c101-68 110-185-3-203" stroke="#bb9269" strokeWidth="2" strokeDasharray="2 8"/>
  <circle className="sculpture-ball" cx="541" cy="145" r="28" fill="url(#steel)"/>
  <path d="m581 302 7 16 17 3-17 5-7 16-4-17-17-4 17-4 4-15Z" fill="#bed8b9"/>
  <g fill="currentColor" fontFamily="monospace" fontSize="10" letterSpacing="2"><text x="40" y="428">PIP / CIRCUIT STUDY</text><text x="598" y="428">NO. 001</text></g>
 </svg>;
}

export default function Landing({onPlay,onWorkshop,onConnect,walletStatus,walletConnected,walletBusy}:Props){
 const [hovered,setHovered]=useState<number|null>(null),[focused,setFocused]=useState(false);
 const active=hovered??(focused?2:null);
 return <section className="landing" aria-label="Welcome to Squeek Pinball">
  <div className="landing-kicker"><span><i/> THE INDEPENDENT SQUEEKCHAIN ARCADE</span><span>BROWSER BUILT. HAND FINISHED.</span></div>
  <h1 className="landing-wordmark" aria-label="Squeek Pinball"><button className="squeek-word" aria-label="Play Squeek Pinball" onClick={onPlay} onPointerLeave={()=>setHovered(null)} onPointerCancel={()=>setHovered(null)} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}>{[...'SQUEEK'].map((letter,index)=><span key={index} className="letter-cell" aria-hidden="true" data-emphasis={active===index?'active':active!==null&&Math.abs(active-index)===1?'neighbor':'idle'} onPointerEnter={e=>{if(e.pointerType!=='touch')setHovered(index);}}><span>{letter}</span></span>)}</button><span className="wordmark-caption" aria-hidden="true">PINBALL <span>SMALL PAWS. BIG ENERGY.</span></span></h1>
  <div className="landing-stage">
   <div className="landing-copy"><span className="landing-overline">01 / COME OUT AND PLAY</span><h2>A little skill.<br/>A little <em>mischief.</em></h2><p>Copper flippers. Quick reflexes. One more ball.<br className="desktop-break"/> An original arcade for the Squeekchain community. Play a house machine, or build one of your own.</p><div className="landing-actions"><button className="play-now" onClick={onPlay}>Play now <span aria-hidden="true">↗</span></button><button className="open-workshop" onClick={onWorkshop}>Open Workshop <span aria-hidden="true">↗</span></button></div><div className="landing-wallet"><button aria-label="Connect Wallet" disabled={walletBusy} onClick={onConnect}>{walletBusy?'Waiting for wallet…':walletConnected?'Wallet connected · reconnect':'Connect Wallet'} <span aria-hidden="true">↗</span></button><span>OPTIONAL · SEPOLIA TESTNET</span></div>{walletStatus&&<p className="landing-wallet-status" role="status">{walletStatus}</p>}<span className="landing-free"><i/> FREE PLAY · NO WALLET NEEDED</span></div>
   <div className="landing-art"><div className="art-caption"><span>THE ART OF THE REBOUND</span><span aria-hidden="true">↙</span></div><CircuitSculpture/></div>
  </div>
  <div className="landing-colophon"><span><b>02</b> HOUSE MACHINES</span><span><b>∞</b> WAYS TO MAKE THEM YOURS</span><p>Play. Tinker. Pass it on.<span>Local saves & shareable blueprints. Yours to shape.</span></p><button onClick={onWorkshop} aria-label="Explore the Workshop">MEET YOUR WORKBENCH <span aria-hidden="true">↗</span></button></div>
 </section>;
}
