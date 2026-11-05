import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { connect } from 'node:net';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { completeProof } from './helpers';

// Public, disposable test material only.
const key = ('0x' + '11'.repeat(32)) as Hex;
const signer = privateKeyToAccount(key);
const dirs: string[] = [];
const services: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const s of services.splice(0)) await s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function environment(extra: Record<string, string> = {}) {
  const root = process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'hermes/cache/scratch') : tmpdir();
  const dir = mkdtempSync(join(root, 'pinball-http-')); dirs.push(dir);
  const keyFile = join(dir, 'key'); writeFileSync(keyFile, key, { mode: 0o600 });
  return { PORT: '0', HOST: '127.0.0.1', DATABASE_PATH: join(dir, 'db.sqlite'), VERIFIER_PRIVATE_KEY_FILE: keyFile,
    VERIFIER_ADDRESS: signer.address, LEADERBOARD_ADDRESS: '0x000000000000000000000000000000000000beef',
    CHAIN_ID: '11155111', ALLOWED_ORIGIN: 'https://game.example', ...extra };
}
async function start(env = environment()) {
  const module = await import('../src/vps/server').catch(() => null);
  expect(module, 'loopback Node HTTP adapter is not implemented').not.toBeNull();
  const service = await module!.startService(env); services.push(service); return service;
}
function http(port: number, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: any }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST',
      headers: { Host: 'game.example', 'Content-Type': 'application/json', ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode!, headers: res.headers, body: text ? JSON.parse(text) : null }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const wallet = '0x00000000000000000000000000000000000000a1';

it('fails configuration closed before binding, opening storage or using signing material', async () => {
  const module = await import('../src/vps/configuration').catch(() => null);
  expect(module, 'validated startup configuration is not implemented').not.toBeNull();
  const valid = environment();
  expect(module!.loadConfiguration(valid).env.VERIFIER_ADDRESS).toBe(signer.address);
  for (const bad of [
    { HOST: '0.0.0.0' }, { HOST: '::' }, { HOST: 'localhost' }, { DATABASE_PATH: ':memory:' }, { DATABASE_PATH: '' },
    { ALLOWED_ORIGIN: 'https://game.example/path' }, { ALLOWED_ORIGIN: 'https://u:p@game.example' },
    { ALLOWED_ORIGIN: 'http://game.example' }, { ALLOWED_ORIGIN: 'https://game.example?x=y' },
    { CHAIN_ID: '1' }, { VERIFIER_ADDRESS: wallet }, { LEADERBOARD_ADDRESS: '0x' + '0'.repeat(40) },
    { VERIFIER_PRIVATE_KEY_FILE: '' }, { PORT: '3.5' }, { RATE_LIMIT: '0' }, { MAX_INFLIGHT: '-1' },
    { BODY_TIMEOUT_MS: 'NaN' }, { MAX_CHALLENGES: '100001' },
  ]) expect(() => module!.loadConfiguration({ ...valid, ...bad })).toThrow('invalid verifier configuration');
});

it('rejects untrusted Host and Origin and never uses forwarded headers as authority', async () => {
  const s = await start();
  expect((await http(s.port, '/v1/tables', undefined, { Host: 'evil.example', 'X-Forwarded-Host': 'game.example', 'X-Forwarded-Proto': 'https' })).status).toBe(421);
  expect((await http(s.port, '/v1/tables', undefined, { Origin: 'https://evil.example', 'X-Forwarded-Host': 'game.example' })).status).toBe(403);
  const good = await http(s.port, '/v1/tables', undefined, { Origin: 'https://game.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-For': '1.2.3.4' });
  expect(good.status).toBe(200); expect(good.headers['access-control-allow-origin']).toBe('https://game.example');
  expect((await http(s.port, 'https://evil.example/v1/tables')).status).toBe(400);
});

it.each(['declared', 'chunked'])('rejects an oversized %s body before the sender finishes', async (mode) => {
  const s = await start();
  const status = await new Promise<number>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: s.port, path: '/v1/challenges', method: 'POST',
      headers: { Host: 'game.example', 'Content-Type': 'application/json', ...(mode === 'declared' ? { 'Content-Length': '300001' } : { 'Transfer-Encoding': 'chunked' }) } }, res => {
      res.resume(); res.on('end', () => { clearTimeout(timer); req.destroy(); resolve(res.statusCode!); });
    });
    const timer = setTimeout(() => { req.destroy(); reject(Error('oversized unfinished body was not rejected promptly')); }, 1_000);
    req.on('error', error => { clearTimeout(timer); reject(error); }); req.flushHeaders();
    if (mode === 'chunked') req.write('x'.repeat(300_001));
  });
  expect(status).toBe(413);
});

it('enforces a bounded global rate budget that spoofed client IPs cannot bypass', async () => {
  const s = await start(environment({ RATE_LIMIT: '2', RATE_WINDOW_MS: '100' }));
  expect((await http(s.port, '/v1/tables')).status).toBe(200);
  expect((await http(s.port, '/v1/tables', undefined, { 'X-Forwarded-For': '1.2.3.4' })).status).toBe(200);
  const denied = await http(s.port, '/v1/tables', undefined, { 'X-Forwarded-For': '5.6.7.8', 'CF-Connecting-IP': '9.8.7.6' });
  expect(denied.status).toBe(429); expect(denied.headers['retry-after']).toBeDefined();
  await new Promise(resolve => setTimeout(resolve, 120));
  expect((await http(s.port, '/v1/tables')).status).toBe(200);
});

it('bounds simultaneous in-flight bodies and releases capacity after a slow-body deadline', async () => {
  const s = await start(environment({ MAX_INFLIGHT: '1', BODY_TIMEOUT_MS: '200' }));
  const arrived = new Promise<void>(resolve => s.server.once('request', () => resolve()));
  let slow!: ReturnType<typeof request>;
  const response = new Promise<number>((resolve, reject) => {
    slow = request({ hostname: '127.0.0.1', port: s.port, path: '/v1/challenges', method: 'POST', headers: { Host: 'game.example', 'Content-Type': 'application/json', 'Content-Length': '10' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode!));
    }); slow.on('error', reject); slow.write(' ');
  });
  response.catch(() => {});
  try {
    await arrived;
    expect((await http(s.port, '/v1/tables')).status).toBe(503);
    expect(await response).toBe(408);
    expect((await http(s.port, '/v1/tables')).status).toBe(200);
  } finally { slow.destroy(); }
});

it('cleans expired challenges at startup and on schedule, keeping live consumed nonces', async () => {
  const env = environment({ CLEANUP_INTERVAL_MS: '100' });
  const service = await start(env);
  const db = new DatabaseSync(env.DATABASE_PATH);
  try {
    const insert = db.prepare("INSERT INTO challenges(nonce,wallet,table_id,variant,expires_at,consumed) VALUES(?,'w','t','standard',?,1)");
    insert.run('expired', 1); insert.run('live-used', 2_000_000_000);
    const deadline = Date.now() + 1_000;
    while (db.prepare("SELECT nonce FROM challenges WHERE nonce='expired'").get() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    expect(db.prepare("SELECT nonce FROM challenges WHERE nonce='expired'").get()).toBeUndefined();
    expect(db.prepare("SELECT consumed FROM challenges WHERE nonce='live-used'").get()).toMatchObject({ consumed: 1 });
    await service.close();
    insert.run('expired-at-restart', 1);
    await start(env);
    expect(db.prepare("SELECT nonce FROM challenges WHERE nonce='expired-at-restart'").get()).toBeUndefined();
  } finally { db.close(); }
});

it('shutdown is idempotent and forcibly bounds unfinished uploads before closing SQLite', async () => {
  const env = environment({ SHUTDOWN_TIMEOUT_MS: '100', BODY_TIMEOUT_MS: '10000' });
  const s = await start(env);
  const arrived = new Promise<void>(resolve => s.server.once('request', () => resolve()));
  const slow = request({ hostname: '127.0.0.1', port: s.port, path: '/v1/challenges', method: 'POST', headers: { Host: 'game.example', 'Content-Length': '10' } });
  slow.on('error', () => {}); slow.write(' ');
  try {
    await arrived;
    const closing = s.close(); expect(s.close()).toBe(closing);
    expect(await Promise.race([closing.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 600))])).toBe(true);
    expect(s.server.listening).toBe(false);
    const restarted = await start(env); expect((await http(restarted.port, '/v1/tables')).status).toBe(200);
  } finally { slow.destroy(); }
});

it('caps open TCP connections, including clients that send no headers', async () => {
  const s = await start(environment({ MAX_CONNECTIONS: '1' }));
  const accepted = new Promise<void>(resolve => s.server.once('connection', () => resolve()));
  const first = connect(s.port, '127.0.0.1');
  first.on('error', () => {});
  await accepted;
  const second = connect(s.port, '127.0.0.1'); second.on('error', () => {});
  try {
    const dropped = new Promise<boolean>(resolve => second.once('close', () => resolve(true)));
    expect(await Promise.race([dropped, new Promise(resolve => setTimeout(() => resolve(false), 250))])).toBe(true);
  } finally { first.destroy(); second.destroy(); }
});

it('rejects headers above 8 KiB at the HTTP parser boundary', async () => {
  const s = await start();
  expect((await http(s.port, '/v1/tables', undefined, { 'X-Padding': 'x'.repeat(9_000) })).status).toBe(431);
});

it('rejects duplicate Host headers rather than trusting the first header', async () => {
  const s = await start();
  const status = await new Promise<string>((resolve, reject) => {
    const socket = connect(s.port, '127.0.0.1', () => socket.end('GET /v1/tables HTTP/1.1\r\nHost: game.example\r\nHost: evil.example\r\nConnection: close\r\n\r\n'));
    let text = ''; socket.on('data', chunk => { text += chunk; }); socket.on('end', () => resolve(text.split('\r\n')[0])); socket.on('error', reject);
  });
  expect(status).toContain('400');
});

it('issues unique concurrent nonces and independently verifies both official tables over HTTP', async () => {
  const s = await start();
  const tables = (await http(s.port, '/v1/tables')).body.tables;
  const bindings = [0, 1, 0, 1].map(index => ({ wallet, tableId: tables[index].tableId, variant: 'standard' }));
  const challenges = await Promise.all(bindings.map(binding => http(s.port, '/v1/challenges', binding)));
  expect(challenges.map(c => c.status)).toEqual([201, 201, 201, 201]);
  expect(new Set(challenges.map(c => c.body.nonce)).size).toBe(4);
  const fixtures = [completeProof(0), completeProof(1)];
  const results = await Promise.all(challenges.map((c, index) => http(s.port, '/v1/verify', { ...bindings[index], nonce: c.body.nonce, proof: fixtures[index % 2].proof })));
  expect(results.map(r => r.status)).toEqual([200, 200, 200, 200]);
  results.forEach((r, index) => expect(r.body.attestation.score).toBe(String(fixtures[index % 2].score)));
});

it('fails challenge issuance closed when persistent capacity is exhausted', async () => {
  const env = environment({ MAX_CHALLENGES: '1' }); const s = await start(env);
  const tableId = (await http(s.port, '/v1/tables')).body.tables[0].tableId;
  const binding = { wallet, tableId, variant: 'standard' };
  expect((await http(s.port, '/v1/challenges', binding)).status).toBe(201);
  const denied = await http(s.port, '/v1/challenges', binding);
  expect(denied).toMatchObject({ status: 503, body: { error: 'verifier unavailable' } });
  const sqlite = new DatabaseSync(env.DATABASE_PATH, { readOnly: true });
  try { expect(sqlite.prepare('SELECT COUNT(*) AS n FROM challenges').get()).toMatchObject({ n: 1 }); } finally { sqlite.close(); }
});

it('serves real HTTP, survives restart, replays official scores and authorizes only one simultaneous submission', async () => {
  const env = environment();
  let service = await start(env);
  expect(service.server.address()).toMatchObject({ address: '127.0.0.1' });
  const tables = await http(service.port, '/v1/tables'); expect(tables.status).toBe(200);
  const binding = { wallet, tableId: tables.body.tables[0].tableId, variant: 'standard' };
  const challenge = await http(service.port, '/v1/challenges', binding); expect(challenge.status).toBe(201);
  await service.close(); service = await start(env);
  const fixture = completeProof();
  const submission = { ...binding, nonce: challenge.body.nonce, proof: fixture.proof };
  const results = await Promise.all([http(service.port, '/v1/verify', submission), http(service.port, '/v1/verify', submission)]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const receipt = results.find(r => r.status === 200)!.body;
  expect(receipt.attestation.score).toBe(String(fixture.score));
  expect(await recoverTypedDataAddress({ domain: receipt.domain, types: receipt.types, primaryType: 'Score', message: receipt.attestation, signature: receipt.signature })).toBe(signer.address);
  expect(JSON.stringify(receipt)).not.toContain(key);
  await service.close(); service = await start(env);
  expect((await http(service.port, '/v1/verify', submission)).status).toBe(409);
});
