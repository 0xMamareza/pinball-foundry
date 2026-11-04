import {afterEach,expect,it,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256,stringToHex} from 'viem';
import {leaderboardConfig,validateAttestation,scoreTypes,verifyFinalScore,submitFinalScore,readLeaderboard,scoreSubmittedFromLogs,leaderboardAbi} from './score-chain';
import {publicClient} from './chain';
import {encodeEventTopics,encodeAbiParameters} from 'viem';

it('reads top-20 ranks from the contract, never from a browser score',async()=>{
 vi.stubEnv('VITE_SCORE_VERIFIER_URL','https://verify.example');vi.stubEnv('VITE_LEADERBOARD_ADDRESS',contract);
 const code=vi.spyOn(publicClient,'getBytecode').mockResolvedValue('0x01');
 const read=vi.spyOn(publicClient,'readContract').mockResolvedValue([{wallet,score:1234n}] as never);
 expect(await readLeaderboard(tableId)).toEqual([{wallet,score:1234n}]);
 expect(read.mock.calls[0][0]).toMatchObject({address:contract,functionName:'getLeaderboard',args:[tableId]});
 code.mockRestore();read.mockRestore();
});
it('recognizes only the exact score event from the configured contract',()=>{
 const a={wallet,tableId,score:'100',nonce,expiresAt:'9999999999',proofHash:tableId};
 const topics=encodeEventTopics({abi:leaderboardAbi,eventName:'ScoreSubmitted',args:{tableId,wallet,nonce}}) as readonly `0x${string}`[];
 const data=encodeAbiParameters([{type:'uint256'},{type:'bytes32'}],[100n,tableId]);
 expect(scoreSubmittedFromLogs([{address:contract,topics,data}],contract,a)).toBe(true);
 expect(scoreSubmittedFromLogs([{address:wallet,topics,data}],contract,a)).toBe(false);
 expect(scoreSubmittedFromLogs([{address:contract,topics,data}],contract,{...a,score:'200'})).toBe(false);
});
it('refuses submission before a wallet or transaction request if the deployment is missing',async()=>{
 vi.stubEnv('VITE_SCORE_VERIFIER_URL','');vi.stubEnv('VITE_LEADERBOARD_ADDRESS','');
 await expect(submitFinalScore({} as never)).rejects.toThrow(/configured/);
});
import {officialTable} from './score-proof';
import {TABLES} from './layout';
const contract='0x1111111111111111111111111111111111111111' as const,wallet='0x2222222222222222222222222222222222222222' as const;
const account=privateKeyToAccount(('0x'+'01'.repeat(32)) as `0x${string}`);
const tableId=officialTable(TABLES[0])!.tableId,nonce=('0x'+'ab'.repeat(32)) as `0x${string}`;
const proof={version:1 as const,inputs:[0],launches:[{step:0,power:1000}]};
const run={tableId,score:100,proof};
const domain={name:'PinballFoundryLeaderboard',version:'1',chainId:11155111,verifyingContract:contract} as const;
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('requires both public verifier URL and nonzero Sepolia leaderboard configuration',()=>{
 expect(leaderboardConfig('','')).toBeNull();
 expect(leaderboardConfig('https://verify.example','0x0000000000000000000000000000000000000000')).toBeNull();
 expect(leaderboardConfig('javascript:alert(1)',contract)).toBeNull();
 expect(leaderboardConfig('http://remote.example',contract)).toBeNull();
 expect(leaderboardConfig('https://verify.example/',contract)).toEqual({url:'https://verify.example',address:contract});
});
it('validates signature, exact game score, proof hash, wallet, nonce, chain and contract before accepting a verifier result',async()=>{
 const attestation={wallet,tableId,score:'100',nonce,expiresAt:String(Math.floor(Date.now()/1000)+600),proofHash:keccak256(stringToHex(JSON.stringify(proof)))};
 const signature=await account.signTypedData({domain,types:scoreTypes,primaryType:'Score',message:{...attestation,score:100n,expiresAt:BigInt(attestation.expiresAt)}});
 const response={attestation,signature,domain};
 expect((await validateAttestation(response,run,wallet,nonce,contract,account.address)).attestation.score).toBe('100');
 for(const changed of [{score:'101'},{wallet:contract},{nonce:tableId},{proofHash:tableId},{expiresAt:'1'}]){
  await expect(validateAttestation({...response,attestation:{...attestation,...changed}},run,wallet,nonce,contract,account.address)).rejects.toThrow();
 }
 await expect(validateAttestation({...response,domain:{...domain,chainId:1}},run,wallet,nonce,contract,account.address)).rejects.toThrow();
 await expect(validateAttestation({...response,domain:{...domain,verifyingContract:wallet}},run,wallet,nonce,contract,account.address)).rejects.toThrow();
 await expect(validateAttestation(response,run,wallet,nonce,contract,wallet)).rejects.toThrow();
});
it('does not request a challenge or a wallet when score submission is unconfigured',async()=>{
 vi.stubEnv('VITE_SCORE_VERIFIER_URL','');vi.stubEnv('VITE_LEADERBOARD_ADDRESS','');
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(verifyFinalScore(run,wallet)).rejects.toThrow(/configured/);
 expect(fetcher).not.toHaveBeenCalled();
});
