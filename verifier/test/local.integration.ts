import { expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { completeProof } from './helpers';
import { scoreTypes } from '../src/typed-data';

it('real workerd + D1 replay attestation submits on loopback Anvil and reads back', async () => {
  // Only disposable deterministic accounts and an ephemeral loopback chain; never a user wallet.
  const signer = privateKeyToAccount(('0x' + '11'.repeat(32)) as Hex);
  const player = privateKeyToAccount(('0x' + '22'.repeat(32)) as Hex);
  const binary = join(process.env.USERPROFILE ?? process.env.HOME!, '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
  const child = spawn(binary, ['--host','127.0.0.1','--port','0','--chain-id','11155111','--accounts','0','--no-cors'], {stdio:['ignore','pipe','pipe']});
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  let mf: Miniflare | undefined;
  try {
    const deadline = Date.now() + 10_000;
    while (!logs.match(/Listening on 127\.0\.0\.1:(\d+)/)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Anvil unavailable: ${logs}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const port = logs.match(/Listening on 127\.0\.0\.1:(\d+)/)![1];
    const transport = http(`http://127.0.0.1:${port}`);
    const chain = sepolia; // Same chain ID/domain as production, but RPC never leaves loopback.
    const pub = createPublicClient({chain, transport});
    const wallet = createWalletClient({chain, transport, account:player});
    await pub.request({method:'anvil_setBalance' as any, params:[player.address, '0x56bc75e2d63100000'] as any});
    const artifact = JSON.parse(readFileSync(new URL('../../contracts/out/PinballFoundryLeaderboard.sol/PinballFoundryLeaderboard.json', import.meta.url), 'utf8'));
    const deploy = await wallet.deployContract({abi:artifact.abi, bytecode:artifact.bytecode.object, args:[signer.address]});
    const deployed = await pub.waitForTransactionReceipt({hash:deploy});
    expect(deployed.status).toBe('success');
    const address = deployed.contractAddress as Address;
    expect(await pub.readContract({address,abi:artifact.abi,functionName:'verifier'})).toBe(signer.address);
    mf = new Miniflare(convertV4MiniflareOptions({modules:true, script:readFileSync(new URL('../dist/worker.js',import.meta.url),'utf8'), compatibilityDate:'2026-10-01',
      d1Databases:['DB'], bindings:{VERIFIER_PRIVATE_KEY:('0x'+'11'.repeat(32)), VERIFIER_ADDRESS:signer.address,
        LEADERBOARD_ADDRESS:address, CHAIN_ID:'11155111', ALLOWED_ORIGIN:'https://game.example'}}));
    const db = await mf.getD1Database('DB');
    await db.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8').replaceAll('\n',' '));
    const fetch = (path:string, body?:unknown) => mf!.dispatchFetch('https://verifier.example'+path, {method:body ? 'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://game.example'},body:body ? JSON.stringify(body):undefined});
    const tables = await (await fetch('/v1/tables')).json() as any;
    const tableId = tables.tables[0].tableId;
    const binding = {wallet:player.address, tableId, variant:'standard'};
    const challengeResponse = await fetch('/v1/challenges',binding);
    expect(challengeResponse.status).toBe(201);
    const challenge = await challengeResponse.json() as any;
    const fixture = completeProof();
    const body = {...binding,nonce:challenge.nonce,proof:fixture.proof};
    const responses = await Promise.all([fetch('/v1/verify',body),fetch('/v1/verify',body)]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const receipt = await responses.find(r=>r.status===200)!.json() as any;
    expect(receipt.attestation.score).toBe(String(fixture.score));
    expect(await db.prepare('SELECT consumed FROM challenges WHERE nonce = ?').bind(challenge.nonce).first('consumed')).toBe(1);
    const attestation = {...receipt.attestation,score:BigInt(receipt.attestation.score),expiresAt:BigInt(receipt.attestation.expiresAt)};
    // Real EIP-712 digest parity between viem/Worker and Solidity (not fabricated signatures).
    const { hashTypedData } = await import('viem');
    expect(await pub.readContract({address,abi:artifact.abi,functionName:'scoreDigest',args:[attestation]})).toBe(hashTypedData({domain:receipt.domain,types:scoreTypes,primaryType:'Score',message:attestation}));
    const hash = await wallet.writeContract({address,abi:artifact.abi,functionName:'submit',args:[attestation,receipt.signature]});
    const tx = await pub.waitForTransactionReceipt({hash});
    expect(tx.status).toBe('success');
    expect(await pub.readContract({address,abi:artifact.abi,functionName:'bestScore',args:[tableId,player.address]})).toBe(BigInt(fixture.score));
    expect(await pub.readContract({address,abi:artifact.abi,functionName:'usedNonces',args:[challenge.nonce]})).toBe(true);
    const top = await pub.readContract({address,abi:artifact.abi,functionName:'getLeaderboard',args:[tableId]}) as any[];
    expect(top).toEqual([{wallet:player.address,score:BigInt(fixture.score)}]);
    await expect(pub.simulateContract({account:player,address,abi:artifact.abi,functionName:'submit',args:[attestation,receipt.signature]})).rejects.toThrow();
    console.log(JSON.stringify({localOnly:true,chainId:11155111,contract:address,deployment:deploy,submission:hash,score:fixture.score,steps:fixture.proof.inputs.length,nonceConsumed:true,leaderboardReadback:true,duplicateRejected:true}));
  } finally {
    await mf?.dispose();
    if (child.exitCode === null) {
      const exited = once(child,'exit');
      child.kill();
      await exited;
    }
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  }
});
