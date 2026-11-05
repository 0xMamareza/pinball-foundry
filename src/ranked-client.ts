import {isAddress,parseAbi,createWalletClient,custom,decodeEventLog,encodeFunctionData,recoverMessageAddress,keccak256,stringToHex,type Address,type Hex} from 'viem';
import {sepolia} from 'viem/chains';
import {injectedProvider,publicClient} from './chain';
import type {ScoreProof} from './score-proof';
export const rankedStartAbi=parseAbi(['function officialTable(bytes32 tableId) view returns (bool)','function startRun(bytes32 tableId)','event RunStarted(address indexed wallet, bytes32 indexed tableId)']);
import {MAX_PROOF_STEPS,SCORE_RULESET,officialTable} from './score-proof';
import {TABLES} from './layout';
export type RankedConfig={api:string;contract:Address};
export function parseRankedConfig(api:string|undefined,contract:string|undefined):RankedConfig|null{
 if(!api||!contract||api.trim()!==api||!isAddress(contract)||/^0x0{40}$/i.test(contract))return null;
 try{const url=new URL(api);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||api!==url.origin&&api!==url.origin+'/')return null;return {api:url.origin,contract};}catch{return null;}
}
export const rankedConfig=()=>parseRankedConfig(import.meta.env.VITE_RANKED_API_URL,import.meta.env.VITE_RANKED_START_ADDRESS);
class RankedHttpError extends Error{constructor(readonly status:number){super(`Ranked service returned HTTP ${status}. No recorded result is confirmed.`);}}
export class RankedAdmissionPending extends Error{constructor(readonly retry:()=>Promise<RankedTicket>){super('Ranked admission is not confirmed. Retry this same start without another transaction or signature.');}}
async function request(config:RankedConfig,path:string,body?:unknown,expectedStatus=200):Promise<Record<string,unknown>>{
 const response=await fetch(config.api+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{'Accept':'application/json'}:{'Accept':'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20_000)});
 if(response.status!==expectedStatus)throw new RankedHttpError(response.status);
 if(response.headers.get('content-type')?.toLowerCase().split(';')[0].trim()!=='application/json')throw Error('Ranked service did not return JSON.');
 const data:unknown=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid ranked service response.');return data as Record<string,unknown>;
}
export async function checkRankedService(config:RankedConfig):Promise<{confirmations:number}>{
 const d=await request(config,'/v2/tables');
 const ids=TABLES.map(t=>officialTable(t)!.tableId);
 if(d.version!==2||d.storage!=='offchain'||d.chainId!==11155111||typeof d.startContract!=='string'||d.startContract.toLowerCase()!==config.contract.toLowerCase()||d.ruleset!==SCORE_RULESET||d.maxSteps!==MAX_PROOF_STEPS||d.authorization!=='personal_sign'||d.runSeconds!==900||!Number.isSafeInteger(d.confirmations)||Number(d.confirmations)<1||Number(d.confirmations)>64||!Array.isArray(d.tables)||d.tables.length!==ids.length||!ids.every(id=>(d.tables as {tableId?:unknown}[]).filter(t=>t?.tableId===id).length===1))throw Error('Incompatible ranked service: chain, contract, ruleset or official tables do not match.');
if(!ids.every((id,index)=>(d.tables as Record<string,unknown>[]).some(t=>t.tableId===id&&t.index===index&&t.title===TABLES[index].title&&t.variant==='standard'&&t.ruleset===SCORE_RULESET)))throw Error('Incompatible ranked service table metadata.');
 return {confirmations:Number(d.confirmations)};
}
const hash=(value:unknown):value is Hex=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const same=(a:unknown,b:string)=>typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
export type RankedTicket=Readonly<{config:RankedConfig;wallet:Address;tableId:Hex;txHash:Hex;nonce:Hex;expiresAt:number}>;
export type RecordedScore={version:2;storage:'offchain';chainId:11155111;txHash:Hex;wallet:Address;tableId:Hex;score:number;proofHash:Hex;verifiedAt:number};
const tickets=new WeakMap<RankedTicket,{invalid:boolean;binding?:string;submission?:Promise<RecordedScore>}>(),issuedStarts=new Set<string>();
export function invalidateRankedRun(ticket:RankedTicket|null){if(ticket){const state=tickets.get(ticket);if(state)state.invalid=true;}}
export function rankedStartMessage(wallet:string,tableId:string,txHash:string,contract:string){return `Pinball Foundry ranked start v2\nChain: 11155111\nContract: ${contract.toLowerCase()}\nWallet: ${wallet.toLowerCase()}\nTable: ${tableId}\nTransaction: ${txHash}\nRuleset: ${SCORE_RULESET}`;}
export async function startRankedRun(tableId:Hex,expectedWallet:string,onStatus:(status:string)=>void=()=>{},isCurrent:()=>boolean=()=>true):Promise<RankedTicket>{
 const config=rankedConfig();if(!config)throw Error('Ranked start contract and API are not configured. Practice needs no wallet.');
 if(!TABLES.some(t=>officialTable(t)!.tableId===tableId)||!isAddress(expectedWallet))throw Error('Select an official standard table and connect a wallet before ranked play.');
 const guard=()=>{if(!isCurrent())throw Error('Ranked start cancelled: the table or run changed. This transaction cannot be reused here.');};
 guard();onStatus('Checking the ranked replay service…');const {confirmations}=await checkRankedService(config);guard();
 const wallet=expectedWallet as Address,provider=injectedProvider(),client=createWalletClient({chain:sepolia,transport:custom(provider)});
 const checkAccount=async()=>{guard();const accounts=await provider.request({method:'eth_accounts'});const chain=await provider.request({method:'eth_chainId'});guard();if(chain!=='0xaa36a7'||!Array.isArray(accounts)||!same(accounts[0],wallet))throw Error('Wallet account or Sepolia network changed. Start a new ranked run.');};
 await checkAccount();if(await publicClient.getChainId()!==11155111)throw Error('Ranked RPC is not Ethereum Sepolia.');guard();
 const code=await publicClient.getBytecode({address:config.contract});guard();if(!code||code==='0x')throw Error('Ranked start contract is not deployed at the configured address.');
 if(!await publicClient.readContract({address:config.contract,abi:rankedStartAbi,functionName:'officialTable',args:[tableId]}))throw Error('Ranked contract does not recognize this official table.');guard();
 const simulation=await publicClient.simulateContract({address:config.contract,abi:rankedStartAbi,functionName:'startRun',args:[tableId],account:wallet});await checkAccount();
 onStatus('Approve ONE start transaction in your wallet. Sepolia test ETH is only for network gas.');
 const txHash=await client.writeContract(simulation.request);guard();if(!hash(txHash))throw Error('Wallet returned an invalid transaction hash.');
 onStatus('Start transaction sent. Waiting for the confirmed Sepolia receipt…');
 const receipt=await publicClient.waitForTransactionReceipt({hash:txHash,confirmations,timeout:180_000});guard();
 if(receipt.status!=='success'||!same(receipt.transactionHash,txHash)||!same(receipt.from,wallet)||!same(receipt.to,config.contract))throw Error('Ranked start receipt did not match the successful transaction.');
 const tx=await publicClient.getTransaction({hash:txHash});guard();
 if(!same(tx.hash,txHash)||!same(tx.from,wallet)||!same(tx.to,config.contract)||tx.value!==0n||tx.input!==encodeFunctionData({abi:rankedStartAbi,functionName:'startRun',args:[tableId]}))throw Error('Ranked start transaction does not match the selected wallet and table.');
 const events=receipt.logs.filter(log=>{if(!same(log.address,config.contract))return false;try{const event=decodeEventLog({abi:rankedStartAbi,eventName:'RunStarted',topics:log.topics,data:log.data,strict:true});return same(event.args.wallet,wallet)&&event.args.tableId===tableId;}catch{return false;}});
 if(events.length!==1||receipt.logs.filter(log=>same(log.address,config.contract)).length!==1)throw Error('No unique matching RunStarted event was confirmed.');
 await checkAccount();onStatus('Authorize this replay with a no-gas wallet signature. This is NOT another transaction.');
 const message=rankedStartMessage(wallet,tableId,txHash,config.contract),signature=await client.signMessage({account:wallet,message});await checkAccount();
 if(!same(await recoverMessageAddress({message,signature}),wallet))throw Error('Replay authorization did not match the connected account.');guard();
 const admit=async():Promise<RankedTicket>=>{
  await checkAccount();onStatus('Binding the confirmed start to a single replay…');
  let run:Record<string,unknown>;try{run=await request(config,'/v2/runs',{wallet,tableId,txHash,signature},201);}catch(error){guard();if(!(error instanceof RankedHttpError)||[409,429,503].includes(error.status))throw new RankedAdmissionPending(admit);throw error;}guard();
  const now=Math.floor(Date.now()/1000);
  if(run.version!==2||run.storage!=='offchain'||!same(run.wallet,wallet)||run.tableId!==tableId||run.txHash!==txHash||!hash(run.nonce)||run.ruleset!==SCORE_RULESET||run.maxSteps!==MAX_PROOF_STEPS||!Number.isSafeInteger(run.expiresAt)||Number(run.expiresAt)<=now||Number(run.expiresAt)>now+900)throw Error('Ranked service returned a mismatched or expired run.');
  const identity=config.api+':'+config.contract.toLowerCase()+':'+txHash;if(issuedStarts.has(identity))throw Error('This start transaction has already been admitted in this session. It cannot start another game.');issuedStarts.add(identity);
  const ticket:RankedTicket=Object.freeze({config:Object.freeze(config),wallet,tableId,txHash,nonce:run.nonce,expiresAt:Number(run.expiresAt)});tickets.set(ticket,{invalid:false});return ticket;
 };return admit();
}
export async function readRankedLeaderboard(tableId:Hex,config:RankedConfig|null=rankedConfig()):Promise<RecordedScore[]>{
 if(!config||!TABLES.some(t=>officialTable(t)!.tableId===tableId))throw Error('Offchain leaderboard is not configured for this official table.');
 const d=await request(config,'/v2/leaderboard?'+new URLSearchParams({tableId}));
 if(d.version!==2||d.storage!=='offchain'||d.tableId!==tableId||!Array.isArray(d.entries)||d.entries.length>20)throw Error('Invalid offchain leaderboard response.');
 const wallets=new Set<string>();
 for(const raw of d.entries){const e=raw as RecordedScore;if(!e||e.version!==2||e.storage!=='offchain'||e.chainId!==11155111||e.tableId!==tableId||!hash(e.txHash)||!hash(e.proofHash)||!isAddress(e.wallet)||/^0x0{40}$/i.test(e.wallet)||!Number.isSafeInteger(e.score)||e.score<0||!Number.isSafeInteger(e.verifiedAt)||e.verifiedAt<=0||e.verifiedAt>Math.floor(Date.now()/1000)+30||Object.keys(e).some(k=>!['version','storage','chainId','txHash','wallet','tableId','score','proofHash','verifiedAt'].includes(k))||wallets.has(e.wallet.toLowerCase()))throw Error('Invalid offchain leaderboard entry.');wallets.add(e.wallet.toLowerCase());}
 const rows=d.entries as RecordedScore[];for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];if(a.score<b.score||a.score===b.score&&(a.verifiedAt>b.verifiedAt||a.verifiedAt===b.verifiedAt&&a.txHash>b.txHash))throw Error('Invalid offchain leaderboard order.');}return rows;
}
export async function submitRankedScore(ticket:RankedTicket,score:number,proof:ScoreProof):Promise<RecordedScore>{
 const state=tickets.get(ticket);if(!state||state.invalid)throw Error('Ranked run is no longer active.');
 const proofHash=keccak256(stringToHex(JSON.stringify({version:1,inputs:proof.inputs,launches:proof.launches.map(a=>({step:a.step,power:a.power}))}))),binding=score+':'+proofHash;
 if(state.binding&&state.binding!==binding)throw Error('Ranked start already used for a different replay.');
 if(state.submission)return state.submission;
 if(!state.binding&&ticket.expiresAt<=Math.floor(Date.now()/1000))throw Error('Ranked run expired. The local score is still yours.');
 if(!Number.isSafeInteger(score)||score<0||proof.version!==1||proof.inputs.length>MAX_PROOF_STEPS)throw Error('Invalid finished replay.');
 state.binding=binding;
 state.submission=(async()=>{
  const body={nonce:ticket.nonce,txHash:ticket.txHash,score,proof};
  const validate=(d:Record<string,unknown>):RecordedScore=>{if(d.version!==2||d.storage!=='offchain'||d.chainId!==11155111||d.txHash!==ticket.txHash||!same(d.wallet,ticket.wallet)||d.tableId!==ticket.tableId||d.score!==score||d.proofHash!==proofHash||!Number.isSafeInteger(d.verifiedAt)||Number(d.verifiedAt)<=0||Number(d.verifiedAt)>Math.floor(Date.now()/1000)+30)throw Error('The recorded score response did not match this replay.');return d as RecordedScore;};
  const recorded=validate(await request(ticket.config,'/v2/scores',body));
  // v2 has no per-run GET. Its idempotent POST reads the persisted exact result back.
  const readback=validate(await request(ticket.config,'/v2/scores',body));if(readback.verifiedAt!==recorded.verifiedAt)throw Error('Persisted result readback did not match.');return readback;
 })().catch(error=>{state.submission=undefined;throw error;});return state.submission;
}
