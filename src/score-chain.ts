import {isAddress,keccak256,stringToHex,recoverTypedDataAddress,parseAbi,decodeEventLog,createWalletClient,custom,type Address,type Hex} from 'viem';
import {sepolia} from 'viem/chains';
import {connectWallet,getRegistryAddress,injectedProvider,publicClient} from './chain';
import {MAX_PROOF_STEPS,SCORE_RULESET,type ScoreProof} from './score-proof';

export type FinalRun={tableId:Hex;score:number;proof:ScoreProof};
export const leaderboardAbi=parseAbi([
 'struct Score { address wallet; bytes32 tableId; uint256 score; bytes32 nonce; uint64 expiresAt; bytes32 proofHash; }',
 'struct Entry { address wallet; uint256 score; }',
 'function submit(Score s, bytes signature)',
 'function getLeaderboard(bytes32 tableId) view returns (Entry[])',
 'function bestScore(bytes32 tableId, address wallet) view returns (uint256)',
 'function usedNonces(bytes32 nonce) view returns (bool)',
 'function verifier() view returns (address)',
 'event ScoreSubmitted(bytes32 indexed tableId, address indexed wallet, uint256 score, bytes32 indexed nonce, bytes32 proofHash)',
]);
export type Leader={wallet:Address;score:bigint};
async function deployed(){
 const {address}=requireLeaderboard(),code=await publicClient.getBytecode({address});
 if(!code||code==='0x')throw Error('No leaderboard contract found at the configured Sepolia address.');
 return address;
}
export async function readLeaderboard(tableId:Hex):Promise<readonly Leader[]>{
 const address=await deployed();
 return publicClient.readContract({address,abi:leaderboardAbi,functionName:'getLeaderboard',args:[tableId]});
}
export function scoreSubmittedFromLogs(logs:readonly {address:string;topics:readonly Hex[];data:Hex}[],contract:string,a:SignedScore['attestation']){
 return logs.some(log=>{
  if(log.address.toLowerCase()!==contract.toLowerCase()||!log.topics.length)return false;
  try{const event=decodeEventLog({abi:leaderboardAbi,data:log.data,topics:log.topics as [Hex,...Hex[]]});
   return event.eventName==='ScoreSubmitted'&&event.args.wallet.toLowerCase()===a.wallet.toLowerCase()&&event.args.tableId===a.tableId&&event.args.score===BigInt(a.score)&&event.args.nonce===a.nonce&&event.args.proofHash===a.proofHash;
  }catch{return false;}
 });
}
export async function submitFinalScore(signed:SignedScore,onBroadcast?:(hash:Hex)=>void){
 const contract=await deployed(),a=signed.attestation;
 if(signed.domain.chainId!==11155111||signed.domain.verifyingContract.toLowerCase()!==contract.toLowerCase()||BigInt(a.expiresAt)<=BigInt(Math.floor(Date.now()/1000)))throw Error('Attestation expired or deployment changed. Verify this run again.');
 const {address}=await connectWallet();
 if(address.toLowerCase()!==a.wallet.toLowerCase())throw Error('Wallet changed. Connect the verified account or verify this run again.');
 const attestation={...a,score:BigInt(a.score),expiresAt:BigInt(a.expiresAt)};
 const simulation=await publicClient.simulateContract({address:contract,abi:leaderboardAbi,functionName:'submit',args:[attestation,signed.signature],account:address as Address});
 const walletClient=createWalletClient({chain:sepolia,transport:custom(injectedProvider())});
 const hash=await walletClient.writeContract(simulation.request);onBroadcast?.(hash);
 const receipt=await publicClient.waitForTransactionReceipt({hash,timeout:180_000});
 if(receipt.status!=='success')throw Error('Score transaction reverted. Your local score is unchanged.');
 if(!scoreSubmittedFromLogs(receipt.logs,contract,a))throw Error('Receipt has no matching ScoreSubmitted event. Confirmation could not be verified.');
 const [used,best,leaders]=await Promise.all([
  publicClient.readContract({address:contract,abi:leaderboardAbi,functionName:'usedNonces',args:[a.nonce]}),
  publicClient.readContract({address:contract,abi:leaderboardAbi,functionName:'bestScore',args:[a.tableId,a.wallet]}),
  readLeaderboard(a.tableId),
 ]);
 if(!used||best<attestation.score)throw Error('Receipt succeeded but the exact onchain record could not be verified.');
 const index=leaders.findIndex(entry=>entry.wallet.toLowerCase()===a.wallet.toLowerCase());
 if(index>=0&&leaders[index].score!==best)throw Error('Onchain best score and rank readback disagree.');
 return {hash,best,rank:index<0?null:index+1,leaders};
}
export const scoreTypes={Score:[
 {name:'wallet',type:'address'},{name:'tableId',type:'bytes32'},{name:'score',type:'uint256'},
 {name:'nonce',type:'bytes32'},{name:'expiresAt',type:'uint64'},{name:'proofHash',type:'bytes32'},
]} as const;
export type SignedScore={attestation:{wallet:Address;tableId:Hex;score:string;nonce:Hex;expiresAt:string;proofHash:Hex};signature:Hex;domain:{name:string;version:string;chainId:number;verifyingContract:Address}};
const bytes32=(v:unknown):v is Hex=>typeof v==='string'&&/^0x[0-9a-fA-F]{64}$/.test(v);
export function leaderboardConfig(url=import.meta.env.VITE_SCORE_VERIFIER_URL,address=import.meta.env.VITE_LEADERBOARD_ADDRESS){
 const valid=getRegistryAddress(address);
 if(!valid||!url)return null;
 try{const u=new URL(url);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))return null;return {url:u.origin,address:valid};}catch{return null;}
}
export function requireLeaderboard(){const config=leaderboardConfig();if(!config)throw Error('Leaderboard not deployed / configured. Your score remains local.');return config;}
export async function validateAttestation(value:unknown,run:FinalRun,wallet:string,nonce:Hex,contract:Address,verifier:Address):Promise<SignedScore>{
 const r=value as SignedScore,a=r?.attestation,d=r?.domain;
 if(!a||!d||d.name!=='PinballFoundryLeaderboard'||d.version!=='1'||d.chainId!==11155111||d.verifyingContract?.toLowerCase()!==contract.toLowerCase()||
  !isAddress(a.wallet??'')||a.wallet.toLowerCase()!==wallet.toLowerCase()||a.tableId!==run.tableId||a.nonce!==nonce||!bytes32(a.nonce)||!bytes32(a.tableId)||!bytes32(a.proofHash)||
  a.score!==String(run.score)||!Number.isSafeInteger(run.score)||!/^[0-9]+$/.test(a.expiresAt)||BigInt(a.expiresAt)<=BigInt(Math.floor(Date.now()/1000))||BigInt(a.expiresAt)>=2n**64n||
  a.proofHash!==keccak256(stringToHex(JSON.stringify(run.proof)))||!/^0x[0-9a-fA-F]{130}$/.test(r.signature??''))throw Error('Verifier response does not match this finished run, wallet or Sepolia contract.');
 const recovered=await recoverTypedDataAddress({domain:d,types:scoreTypes,primaryType:'Score',message:{...a,score:BigInt(a.score),expiresAt:BigInt(a.expiresAt)},signature:r.signature});
 if(recovered.toLowerCase()!==verifier.toLowerCase())throw Error('Verifier signature does not match the onchain verifier.');
 return r;
}
async function request(path:string,body?:unknown){
 const {url}=requireLeaderboard();
 const response=await fetch(url+path,{method:body?'POST':'GET',credentials:'omit',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20_000)});
 const data=await response.json();
 if(!response.ok)throw Error(typeof data?.error==='string'?data.error:'Verifier unavailable. Try again.');
 return data;
}
export async function verifyFinalScore(run:FinalRun,wallet:string):Promise<SignedScore>{
 const {address}=requireLeaderboard();
 const tables=await request('/v1/tables');
 if(tables.version!==1||tables.ruleset!==SCORE_RULESET||tables.maxSteps!==MAX_PROOF_STEPS||!Array.isArray(tables.tables)||!tables.tables.some((t:{tableId:string;variant:string})=>t.tableId===run.tableId&&t.variant==='standard'))throw Error('Verifier ruleset does not match this game build.');
 const binding={wallet,tableId:run.tableId,variant:'standard'};
 const challenge=await request('/v1/challenges',binding);
 if(!bytes32(challenge.nonce)||challenge.wallet?.toLowerCase()!==wallet.toLowerCase()||challenge.tableId!==run.tableId||challenge.variant!=='standard'||challenge.ruleset!==SCORE_RULESET||challenge.maxSteps!==MAX_PROOF_STEPS||challenge.domain?.chainId!==11155111||challenge.domain?.verifyingContract?.toLowerCase()!==address.toLowerCase())throw Error('Verifier challenge does not match this run or Sepolia deployment.');
 const response=await request('/v1/verify',{nonce:challenge.nonce,...binding,proof:run.proof});
 const verifier=await publicClient.readContract({address,abi:[{type:'function',name:'verifier',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],functionName:'verifier'});
 return validateAttestation(response,run,wallet,challenge.nonce,address,verifier);
}
