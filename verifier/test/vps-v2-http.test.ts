import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request } from 'node:http';
import { privateKeyToAccount } from 'viem/accounts';
import { startMessage } from '../src/vps/v2/service';
import { officialTables } from '../src/replay';
const dirs: string[] = [];
const services: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const s of services.splice(0)) await s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function environment(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'hermes/cache/scratch') : tmpdir(), 'pinball-v2-http-')); dirs.push(dir);
  return { PORT: '0', DATABASE_PATH: join(dir, 'ranked.sqlite'), CHAIN_ID: '11155111', ALLOWED_ORIGIN: 'https://game.example',
    START_CONTRACT_ADDRESS: '0x000000000000000000000000000000000000beef', SEPOLIA_RPC_URL: 'http://127.0.0.1:18545', ...extra };
}
async function start(env = environment()) {
  const mod = await import('../src/vps/v2/server').catch(() => null);
  expect(mod, 'ranked HTTP entrypoint missing').not.toBeNull();
  const service = await mod!.startRankedService(env); services.push(service); return service;
}
function http(port: number, extra: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/v2/tables', method: body ? 'POST' : 'GET',
      headers: { Host: 'game.example', ...extra } }, res => {
      let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
    }); req.on('error', reject); req.end(body);
  });
}
it('starts v2 without any signer, serves OFFCHAIN metadata, protects Host/Origin and bounds bodies', async () => {
  const s = await start();
  expect((await http(s.port)).body).toMatchObject({ version: 2, storage: 'offchain', chainId: 11155111 });
  expect((await http(s.port, { Host: 'evil.example', 'X-Forwarded-Host': 'game.example' })).status).toBe(421);
  expect((await http(s.port, { Origin: 'https://evil.example' })).status).toBe(403);
  expect((await http(s.port, { 'Content-Length': '300001' }, 'x')).status).toBe(413);
});
it('fails closed on unsafe configuration and unexpected signer configuration', async () => {
  const mod = await import('../src/vps/v2/server').catch(() => null);
  expect(mod, 'ranked HTTP entrypoint missing').not.toBeNull();
  const env = environment();
  for (const extra of [{ HOST: '0.0.0.0' }, { CHAIN_ID: '1' }, { CONFIRMATIONS: '0' }, { DATABASE_PATH: ':memory:' },
    { SEPOLIA_RPC_URL: 'http://public.example' }, { SEPOLIA_RPC_URL: 'https://u:p@rpc.example' }, { VERIFIER_PRIVATE_KEY: 'unexpected' },
    { ALLOWED_ORIGIN: 'https://game.example/path' }, { START_CONTRACT_ADDRESS: '0x' + '0'.repeat(40) }, { RATE_LIMIT: '0' }]) {
    await expect(mod!.startRankedService({ ...env, ...extra })).rejects.toThrow();
  }
});
it('cancels a stalled RPC on shutdown rather than leaving an active verifier handler behind', async () => {
  const rpc = createServer((_req, _res) => {});
  await new Promise<void>(resolve => rpc.listen(0, '127.0.0.1', resolve));
  const port = (rpc.address() as import('node:net').AddressInfo).port;
  const env = environment({ SEPOLIA_RPC_URL: 'http://127.0.0.1:' + port, SHUTDOWN_TIMEOUT_MS: '100' });
  const s = await start(env);
  const account = privateKeyToAccount(('0x' + '11'.repeat(32)) as `0x${string}`);
  const bound = { wallet: account.address, tableId: officialTables()[0].tableId, txHash: '0x' + '12'.repeat(32), contract: env.START_CONTRACT_ADDRESS };
  const signature = await account.signMessage({ message: startMessage(bound) });
  let observed!: () => void;
  const arrived = new Promise<void>(resolve => { observed = resolve; }); rpc.once('request', observed);
  const response = new Promise<number>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: s.port, path: '/v2/runs', method: 'POST', headers: { Host: 'game.example', 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode!));
    }); req.on('error', reject); req.end(JSON.stringify({ wallet: bound.wallet, tableId: bound.tableId, txHash: bound.txHash, signature }));
  });
  response.catch(() => {});
  try {
    await arrived;
    const closed = await Promise.race([s.close().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 500))]);
    expect(closed, 'stalled RPC outlives bounded shutdown').toBe(true);
    expect(await response).toBe(503);
  } finally { rpc.closeAllConnections(); await new Promise<void>(resolve => rpc.close(() => resolve())); }
});
it('applies the shared global token budget to v2 without trusting spoofed forwarding headers', async () => {
  const s = await start(environment({ RATE_LIMIT: '1', RATE_WINDOW_MS: '100' }));
  expect((await http(s.port)).status).toBe(200);
  expect((await http(s.port, { 'X-Forwarded-For': '1.2.3.4' })).status).toBe(429);
  await new Promise(resolve => setTimeout(resolve, 120));
  expect((await http(s.port)).status).toBe(200);
});
