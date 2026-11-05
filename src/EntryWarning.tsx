import {useEffect,useRef} from 'react';
export default function EntryWarning({destination,onContinue,onBack}:{destination:string;onContinue:()=>void;onBack:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current,previous=document.activeElement as HTMLElement|null;if(dialog){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}return()=>{dialog?.close?.();previous?.focus();};},[]);
 return <dialog ref={ref} className="entry-warning" aria-labelledby="warning-title" aria-describedby="warning-description" onCancel={e=>{e.preventDefault();onBack();}}>
  <span className="eyebrow">BEFORE YOU STEP INSIDE · TESTNET ONLY</span><div className="warning-symbol" aria-hidden="true">↗</div>
  <h2 id="warning-title">A safer way to play</h2>
  <div id="warning-description"><p>Use a separate <strong>burner wallet</strong>, not a wallet holding anything valuable.</p><p>Wallet features use <strong>Ethereum Sepolia testnet</strong>. These smart contracts are <strong>unaudited</strong>. Testnet does not mean risk-free.</p><p><strong>Practice needs no wallet.</strong> Ranked official runs have <strong>two pre-play wallet prompts</strong>: one transaction using testnet ETH for gas, then one no-gas personal_sign signature to bind your replay. Scores are replay-verified and saved offchain automatically—never a second score transaction.</p></div>
  <div className="warning-actions"><button onClick={onBack}>Back to landing</button><button className="primary" autoFocus onClick={onContinue}>Continue to {destination}</button></div>
  <p className="small-note">No tokens, prizes or real-value payments. Connecting never starts a transaction.</p>
 </dialog>;
}
