import {useState} from 'react';
import type {Hex} from 'viem';
import {connectWallet} from './chain';
import {leaderboardConfig,verifyFinalScore,submitFinalScore,readLeaderboard,type SignedScore,type Leader} from './score-chain';
import type {ScoreProof} from './score-proof';
export type FinishedRun={score:number;tableId:Hex|null;proof:ScoreProof|null;reason:string};
const message=(error:unknown)=>error instanceof Error?error.message:'Request failed. Try again.';
export default function ScoreResults({result,tableId,title,onStandard}:{result:FinishedRun|null;tableId:Hex|null;title:string;onStandard?:()=>void}){
 const configured=!!leaderboardConfig();
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[signed,setSigned]=useState<SignedScore|null>(null),[hash,setHash]=useState<Hex|null>(null),[confirmed,setConfirmed]=useState(false),[leaders,setLeaders]=useState<readonly Leader[]|null>(null),[rank,setRank]=useState<number|null>(null),[best,setBest]=useState<bigint|null>(null);
 const eligible=!!result?.tableId&&!!result.proof;
 const verify=async()=>{
  if(!result?.proof||!result.tableId||!configured)return;
  setBusy(true);setStatus('Connect on Ethereum Sepolia to verify this replay. No transaction yet.');setSigned(null);
  try{
   const {address}=await connectWallet();setStatus('Replaying your finished run on the verifier… No gas is used.');
   const proof=await verifyFinalScore({tableId:result.tableId,score:result.score,proof:result.proof},address);
   setSigned(proof);setStatus('Verifier signed the matching final score. Not submitted onchain. Submit only if you want a public record.');
  }catch(e){setStatus(message(e));}finally{setBusy(false);}
 };
 const submit=async()=>{
  if(!signed||busy)return;setBusy(true);setStatus('Approve the score transaction in your wallet. Sepolia test ETH gas is required.');
  try{const receipt=await submitFinalScore(signed,h=>{setHash(h);setStatus('Transaction broadcast. Waiting for the Sepolia receipt and exact record readback…');});
   setConfirmed(true);setHash(receipt.hash);setLeaders(receipt.leaders);setRank(receipt.rank);setBest(receipt.best);setStatus('Confirmed on Sepolia: matching score event, nonce and best score read back.');
  }catch(e){setStatus(message(e));}finally{setBusy(false);}
 };
 const refresh=async()=>{
  if(!tableId||!configured)return;setBusy(true);setStatus('Reading the Sepolia top 20…');setLeaders(null);
  try{setLeaders(await readLeaderboard(tableId));setStatus('Leaderboard read directly from Ethereum Sepolia.');}catch(e){setStatus(message(e));}finally{setBusy(false);}
 };
 return <section className="leaderboard-panel" aria-label="Final score and Sepolia leaderboard">
  <div className="panel-top"><span>{result?'SHIFT RESULTS':'VERIFIED RANKINGS'}</span><span>↗</span></div>
  {result?<><h3 tabIndex={-1}>Shift complete</h3><output className="final-score" aria-label="Final local score">{result.score.toLocaleString()}</output><p>Game-generated local score · {confirmed?'onchain submission confirmed':'not submitted onchain'}.</p>
   {result.reason&&<p className="score-eligibility">{result.reason}</p>}
   {eligible&&<><p className="small-note">Replay saved for this result ({result.proof!.inputs.length.toLocaleString()} fixed steps). Restarting or leaving this table discards it.</p><button className="primary full" disabled={!configured||busy||confirmed} onClick={verify}>{busy?'Waiting…':signed?'Verify replay again':'Connect wallet & verify replay'}</button>
    {signed&&!confirmed&&<><p className="small-note">Verified wallet: <span className="wallet-address">{signed.attestation.wallet}</span>. Proof expires {new Date(Number(signed.attestation.expiresAt)*1000).toLocaleTimeString()}.</p><button className="primary full" disabled={busy} onClick={submit}>Submit score to Sepolia ↗</button></>}
   </>}
   {confirmed&&<p className="score-confirmed">Onchain best: {best?.toLocaleString()} · {rank?'Top-20 rank #'+rank:'Outside the onchain top 20'}</p>}
  </>:<p>Finish all three balls first. Wallet verification and a score transaction are optional after play.</p>}
  {!tableId&&onStandard&&<button className="full" onClick={onStandard}>Start official standard run ↗</button>}
  {!configured&&<div className="score-unavailable"><b>Leaderboard not deployed / configured.</b><p>Verified submission and online ranks are unavailable. Free play still works; no online result is claimed.</p></div>}
  <h4>SEPOLIA · {title} · TOP 20</h4>
  {tableId?<button className="full" onClick={refresh} disabled={!configured||busy}>Refresh onchain leaderboard</button>:<p className="small-note">Only official, standard (uncharged) tables have verified rankings.</p>}
  {leaders!==null&&(leaders.length?<ol className="leaderboard-list">{leaders.map((entry,i)=><li key={entry.wallet}><span>#{i+1}</span><abbr title={entry.wallet}>{entry.wallet.slice(0,6)}…{entry.wallet.slice(-4)}</abbr><b>{entry.score.toLocaleString()}</b></li>)}</ol>:<p>No onchain entries for this table.</p>)}
  <p className="chain-status" role="status">{status}</p>
  {hash&&<a href={'https://sepolia.etherscan.io/tx/'+hash} target="_blank" rel="noreferrer">{confirmed?'View confirmed score transaction':'Inspect broadcast transaction'} ↗</a>}
  <p className="small-note">Verifier-attested replay, not a trustless proof of human play. Public wallet + score; Sepolia testnet only. No tokens or prizes.</p>
 </section>;
}
