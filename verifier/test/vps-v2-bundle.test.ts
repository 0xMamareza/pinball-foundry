import { expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { completeProof } from './helpers';
import { startMessage } from '../src/vps/v2/service';
import { startAbi } from '../src/vps/v2/chain';

it('builds deterministic v2 portable artifact, runs a simulated-RPC authenticated replay HTTP roundtrip and survives process restart', async () => {
  const build = () => spawnSync(process.execPath, ['scripts/build-vps.mjs', '--v2'], { encoding: 'utf8' });
  const first = build(); expect(first.status, first.stderr).toBe(0);
  const artifact = new URL('../dist/vps-v2/server.mjs', import.meta.url);
  expect(existsSync(artifact), 'portable ranked v2 bundle missing').toBe(true);
  const bytes = readFileSync(artifact);
  expect(build().status).toBe(0); expect(readFileSync(artifact).equals(bytes)).toBe(true);
  const manifest = JSON.parse(readFileSync(new URL('../dist/vps-v2/manifest.json', import.meta.url), 'utf8'));
  const notices = readFileSync(new URL('../dist/vps-v2/THIRD_PARTY_NOTICES.txt', import.meta.url));
  expect(manifest.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(manifest.noticesSha256).toBe(createHash('sha256').update(notices).digest('hex'));
  for (const name of manifest.packages) expect(notices.toString()).toContain(name + '@');
  expect(bytes.toString()).not.toContain('privateKeyToAccount');
  const root = process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'hermes/cache/scratch') : tmpdir();
  const dir = mkdtempSync(join(root, 'pinball-v2-bundle-')); copyFileSync(artifact, join(dir, 'server.mjs'));
  const account = privateKeyToAccount(('0x' + '11'.repeat(32)) as `0x${string}`);
  const contract = '0x000000000000000000000000000000000000beef';
  const txHash = '0x' + '12'.repeat(32); const blockHash = '0x' + '34'.repeat(32);
  let tableId: `0x${string}`;
  // Explicit RPC simulation, NOT a real chain or public transaction.
  const rpc = createServer((req, res) => {
    let text = ''; req.on('data', chunk => text += chunk); req.on('end', () => {
      const { method } = JSON.parse(text);
      const results: Record<string, unknown> = {
        eth_chainId: '0xaa36a7', eth_blockNumber: '0x12',
        eth_getTransactionByHash: { hash: txHash, from: account.address, to: contract, chainId: '0xaa36a7', value: '0x0',
          blockHash, blockNumber: '0x10', input: encodeFunctionData({ abi: startAbi, functionName: 'startRun', args: [tableId] }) },
        eth_getTransactionReceipt: { transactionHash: txHash, from: account.address, to: contract, status: '0x1', blockHash, blockNumber: '0x10', logs: [
          { address: contract, topics: [keccak256(stringToHex('RunStarted(address,bytes32)')), encodeAbiParameters([{ type: 'address' }], [account.address]), tableId], data: '0x',
            transactionHash: txHash, blockHash, blockNumber: '0x10', removed: false }] },
        eth_getBlockByNumber: { hash: blockHash, number: '0x10', timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) },
      };
      expect(Object.hasOwn(results, method), 'only read RPCs permitted').toBe(true);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: results[method] }));
    });
  });
  await new Promise<void>(resolve => rpc.listen(0, '127.0.0.1', resolve));
  const rpcPort = (rpc.address() as import('node:net').AddressInfo).port;
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', ALLOWED_ORIGIN: 'https://game.example', DATABASE_PATH: join(dir, 'ranked.sqlite'),
    CHAIN_ID: '11155111', START_CONTRACT_ADDRESS: contract, SEPOLIA_RPC_URL: 'http://127.0.0.1:' + rpcPort,
    VERIFIER_PRIVATE_KEY: undefined, VERIFIER_PRIVATE_KEY_FILE: undefined, VERIFIER_ADDRESS: undefined, LEADERBOARD_ADDRESS: undefined };
  let child: ChildProcess | undefined; let logs = '';
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; if (process.platform !== 'win32') expect(child.exitCode).toBe(0); }
  }
  async function launch() {
    child = spawn(process.execPath, ['server.mjs'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }); let text = '';
    child.stdout!.on('data', c => { text += c; logs += c; }); child.stderr!.on('data', c => logs += c);
    const deadline = Date.now() + 5000;
    while (!text.includes('"event":"listening"')) {
      if (child.exitCode !== null || Date.now() > deadline) throw Error('ranked bundle startup failed: ' + logs);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return JSON.parse(text.trim().split('\n').find(line => line.includes('"event":"listening"'))!).port;
  }
  function http(port: number, path: string, body?: unknown) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers: { Host: 'game.example', 'Content-Type': 'application/json' } }, res => {
        let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
      }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  try {
    const port = await launch(); const tables = await http(port, '/v2/tables'); tableId = tables.body.tables[0].tableId;
    const bound = { wallet: account.address, contract, tableId, txHash };
    const signature = await account.signMessage({ message: startMessage(bound) });
    const started = await http(port, '/v2/runs', { wallet: account.address, tableId, txHash, signature }); expect(started.status).toBe(201);
    const payload = { txHash, nonce: started.body.nonce, ...completeProof() };
    const scored = await http(port, '/v2/scores', payload); expect(scored.status).toBe(200); expect(scored.body.storage).toBe('offchain');
    await stop(); const restarted = await launch();
    expect((await http(restarted, '/v2/leaderboard?tableId=' + tableId)).body.entries).toEqual([scored.body]);
    expect((await http(restarted, '/v2/scores', payload)).body).toEqual(scored.body);
    await stop();
    const invalid = spawnSync(process.execPath, ['server.mjs'], { cwd: dir, env: { ...env, HOST: '0.0.0.0' }, encoding: 'utf8', timeout: 5000 });
    expect(invalid.status).toBe(1); expect(invalid.stderr).toContain('ranked startup failed');
    expect(logs).not.toContain(signature); expect(logs).not.toContain(started.body.nonce);
    if (process.platform !== 'win32') expect(logs).toContain('"event":"stopped"');
    console.log(JSON.stringify({ portableV2: true, node: process.version, sha256: manifest.sha256, bytes: bytes.length, simulatedRpcOnly: true, processRestartPersistence: true }));
  } finally { await stop(); rpc.closeAllConnections(); await new Promise<void>(resolve => rpc.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
