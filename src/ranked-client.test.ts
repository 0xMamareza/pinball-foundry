import {afterEach,expect,it,vi} from 'vitest';
import {parseRankedConfig,checkRankedService,startRankedRun,submitRankedScore,invalidateRankedRun,rankedStartAbi,RankedAdmissionPending,readRankedLeaderboard} from './ranked-client';
import {encodeEventTopics,encodeFunctionData,keccak256,stringToHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const mocks=vi.hoisted(()=>({connectWallet:vi.fn(),provider:{request:vi.fn()},rpc:{getChainId:vi.fn(),getBytecode:vi.fn(),readContract:vi.fn(),simulateContract:vi.fn(),waitForTransactionReceipt:vi.fn(),getTransaction:vi.fn()},wallet:{writeContract:vi.fn(),signMessage:vi.fn()}}));
vi.mock('./chain',()=>({connectWallet:mocks.connectWallet,injectedProvider:()=>mocks.provider,publicClient:mocks.rpc}));
vi.mock('viem',async()=>({...await vi.importActual('viem'),createWalletClient:()=>mocks.wallet}));
import {SCORE_RULESET,MAX_PROOF_STEPS,officialTable} from './score-proof';
import {TABLES} from './layout';
const contract='0x1111111111111111111111111111111111111111';
const config={api:'https://example.com',contract} as const;
const metadata=()=>({version:2,storage:'offchain',chainId:11155111,startContract:contract,ruleset:SCORE_RULESET,maxSteps:MAX_PROOF_STEPS,confirmations:2,authorization:'personal_sign',runSeconds:900,tables:TABLES.map(t=>officialTable(t))});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();vi.clearAllMocks();});
let fixtureId=0;
function startFixture(){
 vi.stubEnv('VITE_RANKED_API_URL',config.api);vi.stubEnv('VITE_RANKED_START_ADDRESS',config.contract);
 const account=privateKeyToAccount(('0x'+'11'.repeat(32)) as `0x${string}`),wallet=account.address.toLowerCase();
 const tableId=officialTable(TABLES[0])!.tableId,txHash=('0x'+(++fixtureId).toString(16).padStart(64,'0')) as `0x${string}`,nonce='0x'+'cd'.repeat(32);
 const run={version:2,storage:'offchain',wallet,tableId,txHash,nonce,expiresAt:Math.floor(Date.now()/1000)+900,ruleset:SCORE_RULESET,maxSteps:MAX_PROOF_STEPS};
 mocks.connectWallet.mockResolvedValue({address:account.address});mocks.provider.request.mockImplementation(async({method}:{method:string})=>method==='eth_accounts'?[account.address]:'0xaa36a7');
 mocks.rpc.getChainId.mockResolvedValue(11155111);mocks.rpc.getBytecode.mockResolvedValue('0x1234');mocks.rpc.readContract.mockResolvedValue(true);mocks.rpc.simulateContract.mockResolvedValue({request:{}});mocks.wallet.writeContract.mockResolvedValue(txHash);mocks.wallet.signMessage.mockImplementation(({message}:{message:string})=>account.signMessage({message}));
 const receipt={status:'success',transactionHash:txHash,from:account.address,to:contract,logs:[{address:contract,data:'0x',topics:encodeEventTopics({abi:rankedStartAbi,eventName:'RunStarted',args:{wallet:account.address,tableId}})}]};
 mocks.rpc.waitForTransactionReceipt.mockResolvedValue(receipt);mocks.rpc.getTransaction.mockResolvedValue({hash:txHash,from:account.address,to:contract,value:0n,input:encodeFunctionData({abi:rankedStartAbi,functionName:'startRun',args:[tableId]})});
 const fetcher=vi.fn().mockImplementation(async(url:string)=>url.endsWith('/v2/tables')?Response.json(metadata()):Response.json(run,{status:201}));vi.stubGlobal('fetch',fetcher);
 return {wallet:account.address,tableId,txHash,run,receipt,fetcher};
}
it('requires one receipt-bound pre-play transaction, then records automatically without another wallet action',async()=>{
 const f=startFixture();const ticket=await startRankedRun(f.tableId,f.wallet);
 expect(mocks.wallet.writeContract).toHaveBeenCalledOnce();expect(mocks.wallet.signMessage).toHaveBeenCalledOnce();
 expect(mocks.rpc.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({hash:f.txHash,confirmations:2}));
 expect(mocks.wallet.signMessage.mock.calls[0][0].message).toBe(`Pinball Foundry ranked start v2\nChain: 11155111\nContract: ${contract}\nWallet: ${f.wallet.toLowerCase()}\nTable: ${f.tableId}\nTransaction: ${f.txHash}\nRuleset: ${SCORE_RULESET}`);
 const proof={version:1 as const,inputs:[0],launches:[{step:0,power:1000}]};
 const recorded={version:2,storage:'offchain',chainId:11155111,txHash:f.txHash,wallet:f.run.wallet,tableId:f.tableId,score:250,proofHash:keccak256(stringToHex(JSON.stringify(proof))),verifiedAt:Math.floor(Date.now()/1000)};
 f.fetcher.mockImplementation(async()=>Response.json(recorded));
 expect(await submitRankedScore(ticket,250,proof)).toMatchObject(recorded);
 expect(await submitRankedScore(ticket,250,proof)).toMatchObject(recorded);
 expect(f.fetcher.mock.calls.filter(([url])=>url.endsWith('/v2/scores'))).toHaveLength(2);
 await expect(submitRankedScore(ticket,251,proof)).rejects.toThrow(/already used/i);
 expect(mocks.wallet.writeContract).toHaveBeenCalledOnce();expect(mocks.connectWallet).not.toHaveBeenCalled();
});
it('retries an unconfirmed admission with the exact signature and tx, never another wallet approval',async()=>{
 const f=startFixture();f.fetcher.mockImplementationOnce(async()=>Response.json(metadata())).mockResolvedValueOnce(Response.json({error:'start unconfirmed'},{status:409}));
 let pending:unknown;try{await startRankedRun(f.tableId,f.wallet);}catch(error){pending=error;}
 expect(pending).toBeInstanceOf(RankedAdmissionPending);
 f.fetcher.mockImplementation(async()=>Response.json(f.run,{status:201}));
 expect((await (pending as RankedAdmissionPending).retry()).txHash).toBe(f.txHash);
 expect(mocks.wallet.writeContract).toHaveBeenCalledOnce();expect(mocks.wallet.signMessage).toHaveBeenCalledOnce();
 const starts=f.fetcher.mock.calls.filter(([url])=>url.endsWith('/v2/runs'));expect(starts).toHaveLength(2);expect(starts[0][1].body).toBe(starts[1][1].body);
});
it('retains the exact failed score proof for no-wallet retry and rejects bad readback',async()=>{
 const f=startFixture(),ticket=await startRankedRun(f.tableId,f.wallet),proof={version:1 as const,inputs:[0],launches:[{step:0,power:1000}]};
 f.fetcher.mockResolvedValueOnce(Response.json({error:'busy'},{status:503}));await expect(submitRankedScore(ticket,250,proof)).rejects.toThrow(/503/);
 const recorded={version:2,storage:'offchain',chainId:11155111,txHash:f.txHash,wallet:f.run.wallet,tableId:f.tableId,score:250,proofHash:keccak256(stringToHex(JSON.stringify(proof))),verifiedAt:Math.floor(Date.now()/1000)};
 f.fetcher.mockImplementation(async()=>Response.json(recorded));expect(await submitRankedScore(ticket,250,proof)).toMatchObject(recorded);
 expect(mocks.wallet.writeContract).toHaveBeenCalledOnce();
});
it('invalidates a ticket on leave and rejects reverted, unrelated-event and account-change starts',async()=>{
 let f=startFixture(),ticket=await startRankedRun(f.tableId,f.wallet);invalidateRankedRun(ticket);
 await expect(submitRankedScore(ticket,250,{version:1,inputs:[0],launches:[]})).rejects.toThrow(/no longer active/);
 f=startFixture();mocks.rpc.waitForTransactionReceipt.mockResolvedValueOnce({...f.receipt,status:'reverted'});await expect(startRankedRun(f.tableId,f.wallet)).rejects.toThrow(/receipt/);
 f=startFixture();mocks.rpc.waitForTransactionReceipt.mockResolvedValueOnce({...f.receipt,logs:[]});await expect(startRankedRun(f.tableId,f.wallet)).rejects.toThrow(/RunStarted/);
 f=startFixture();mocks.provider.request.mockImplementation(async({method}:{method:string})=>method==='eth_accounts'?[contract]:'0xaa36a7');await expect(startRankedRun(f.tableId,f.wallet)).rejects.toThrow(/account or Sepolia/);
});
it('reads only valid offchain leaderboard rows for the selected official table',async()=>{
 const f=startFixture(),entry={version:2,storage:'offchain',chainId:11155111,txHash:f.txHash,wallet:f.run.wallet,tableId:f.tableId,score:250,proofHash:'0x'+'ef'.repeat(32),verifiedAt:Math.floor(Date.now()/1000)};
 f.fetcher.mockImplementation(async()=>Response.json({version:2,storage:'offchain',tableId:f.tableId,entries:[entry]}));expect(await readRankedLeaderboard(f.tableId,config)).toEqual([entry]);
 f.fetcher.mockImplementation(async()=>Response.json({version:2,storage:'offchain',tableId:f.tableId,entries:[{...entry,score:-1}]}));await expect(readRankedLeaderboard(f.tableId,config)).rejects.toThrow(/leaderboard/i);
});
it('fails closed on missing, malformed, credential-bearing or non-HTTPS ranked configuration',()=>{
 const address='0x1111111111111111111111111111111111111111';
 for(const url of [undefined,'','https://user:pass@example.com','http://example.com','javascript:alert(1)','https://example.com/v2','https://example.com/?token=x','https://example.com/#x',' https://example.com'])expect(parseRankedConfig(url,address)).toBeNull();
 for(const a of [undefined,'','0x0','0x0000000000000000000000000000000000000000',address+' '])expect(parseRankedConfig('https://example.com',a)).toBeNull();
 expect(parseRankedConfig('https://example.com',address)).toEqual({api:'https://example.com',contract:address});
 expect(parseRankedConfig('http://127.0.0.1:1234',address)).toBeNull();
});
it('accepts only compatible v2 offchain metadata and fails honestly on bad HTTP or bindings',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json(metadata()));vi.stubGlobal('fetch',fetcher);
 expect(await checkRankedService(config)).toEqual({confirmations:2});
 expect(fetcher.mock.calls[0][0]).toBe('https://example.com/v2/tables');
 expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error',cache:'no-store'});
 for(const bad of [{version:1},{storage:'onchain'},{chainId:1},{startContract:'0x2222222222222222222222222222222222222222'},{ruleset:'0x00'},{confirmations:0},{authorization:'none'},{tables:[]}]){
  fetcher.mockResolvedValueOnce(Response.json({...metadata(),...bad}));await expect(checkRankedService(config)).rejects.toThrow(/incompatible/i);
 }
 fetcher.mockResolvedValueOnce(Response.json({error:'unavailable'},{status:503}));await expect(checkRankedService(config)).rejects.toThrow(/503/);
 fetcher.mockResolvedValueOnce(new Response('<html/>',{headers:{'Content-Type':'text/html'}}));await expect(checkRankedService(config)).rejects.toThrow(/JSON/i);
});
