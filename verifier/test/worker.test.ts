import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress, type Hex } from 'viem';
import worker from '../src/worker';
import { officialTables } from '../src/replay';
import { completeProof } from './helpers';

// Disposable, public test-only signing material; never a funded/user key.
const key = ('0x' + '11'.repeat(32)) as Hex;
const account = privateKeyToAccount(key);
const wallet = '0x00000000000000000000000000000000000000a1';
const tableId = officialTables()[0].tableId;
let sqlite: DatabaseSync;
let env: any;
function d1(db: DatabaseSync) {
  return { prepare(sql: string) {
    let args: any[] = [];
    return {
      bind(...values: any[]) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
  } };
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001.sql', import.meta.url), 'utf8'));
  env = { DB: d1(sqlite), VERIFIER_PRIVATE_KEY: key, VERIFIER_ADDRESS: account.address,
    LEADERBOARD_ADDRESS: '0x000000000000000000000000000000000000beef', CHAIN_ID: '11155111', ALLOWED_ORIGIN: 'https://game.example' };
});
afterEach(() => sqlite.close());
async function req(path: string, body?: unknown, headers: Record<string,string> = {}) {
  return worker.fetch(new Request('https://verifier.example' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}
async function challenge(overrides = {}) {
  const response = await req('/v1/challenges', {wallet, tableId, variant:'standard', ...overrides});
  expect(response.status).toBe(201);
  return response.json() as Promise<any>;
}
function submission(c: any) { return { nonce:c.nonce, wallet, tableId, variant:'standard', proof:completeProof().proof }; }

it.each([
  ['wallet', '0x00000000000000000000000000000000000000a2'],
  ['tableId', officialTables()[1].tableId],
  ['variant', 'charged'],
])('rejects challenge %s substitution', async (field, value) => {
  const c = await challenge();
  expect((await req('/v1/verify', {...submission(c), [field]:value})).status).toBe(400);
  expect((await req('/v1/verify', submission(c))).status).toBe(200);
});
it('rejects unknown, expired, missing and corrupt proofs without consuming valid challenges', async () => {
  const c = await challenge();
  expect((await req('/v1/verify', {...submission(c), nonce:'0x'+'ff'.repeat(32)})).status).toBe(404);
  expect((await req('/v1/verify', {...submission(c), proof:{version:1,inputs:[0],launches:[]}})).status).toBe(400);
  const extra = {...submission(c), score:999999};
  expect((await req('/v1/verify', extra)).status).toBe(400);
  expect((await req('/v1/verify', {...submission(c), proof:null})).status).toBe(400);
  sqlite.prepare('UPDATE challenges SET expires_at = 1 WHERE nonce = ?').run(c.nonce);
  expect((await req('/v1/verify', submission(c))).status).toBe(410);
});
it('atomically authorizes at most one of two concurrent submissions', async () => {
  const c = await challenge();
  const responses = await Promise.all([req('/v1/verify', submission(c)), req('/v1/verify', submission(c))]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
});
it('validates tables, variant, wallet, method, content type, origin and bounded bytes', async () => {
  for (const overrides of [{tableId:'0x'+'ff'.repeat(32)}, {variant:'safe'}, {wallet:'not-a-wallet'}, {score:42}]) {
    expect((await req('/v1/challenges', {wallet,tableId,variant:'standard',...overrides})).status).toBe(400);
  }
  expect((await req('/v1/challenges')).status).toBe(405);
  expect((await req('/v1/challenges', {}, {'Content-Type':'text/plain'})).status).toBe(415);
  expect((await req('/v1/challenges', {}, {Origin:'https://attacker.example'})).status).toBe(403);
  expect((await req('/v1/challenges', {}, {'Content-Length':'999999'})).status).toBe(413);
  expect((await req('/v1/challenges', {padding:'x'.repeat(300_001)})).status).toBe(413);
  const good = await req('/v1/tables', undefined, {Origin:env.ALLOWED_ORIGIN});
  expect(good.headers.get('Access-Control-Allow-Origin')).toBe(env.ALLOWED_ORIGIN);
});
it('fails closed without durable storage or with signer/domain misconfiguration', async () => {
  for (const bad of [{DB:undefined},{VERIFIER_PRIVATE_KEY:undefined},{VERIFIER_ADDRESS:wallet},{LEADERBOARD_ADDRESS:'0x0000000000000000000000000000000000000000'},{CHAIN_ID:'bad'}]) {
    const saved = {...env}; Object.assign(env,bad);
    expect((await req('/v1/challenges', {wallet,tableId,variant:'standard'})).status).toBe(503);
    env=saved;
  }
});

it('rejects non-Sepolia chains and malformed origins before issuing challenges', async () => {
  for (const bad of [{CHAIN_ID:'1'}, {CHAIN_ID:'31337'}, {ALLOWED_ORIGIN:'https://user:pass@game.example'}, {ALLOWED_ORIGIN:'https://game.example?x=y'}, {ALLOWED_ORIGIN:'not-an-origin'}]) {
    const saved = {...env}; Object.assign(env,bad);
    expect((await req('/v1/challenges', {wallet,tableId,variant:'standard'})).status).toBe(503);
    env = saved;
  }
});

it('bounds an actual chunked body with no trustworthy Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(100_001).fill(32)); },
    cancel() { cancelled = true; },
  });
  const request = new Request('https://verifier.example/v1/challenges', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:stream, duplex:'half',
  } as RequestInit);
  const response = await worker.fetch(request, env);
  expect(response.status).toBe(413);
  expect(cancelled).toBe(true);
});
it('rejects malformed UTF8, JSON, compressed JSON and extra proof fields', async () => {
  for (const bytes of [new Uint8Array([0xff]), new TextEncoder().encode('{bad')]) {
    const response = await worker.fetch(new Request('https://verifier.example/v1/challenges', {method:'POST',headers:{'Content-Type':'application/json'},body:bytes}),env);
    expect(response.status).toBe(400);
  }
  expect((await req('/v1/challenges', {}, {'Content-Encoding':'gzip'})).status).toBe(415);
});
it('allows the exact origin preflight without credentials and exposes no signing material', async () => {
  const response = await worker.fetch(new Request('https://verifier.example/v1/verify', {method:'OPTIONS',headers:{Origin:env.ALLOWED_ORIGIN}}),env);
  expect(response.status).toBe(204);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(env.ALLOWED_ORIGIN);
  expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
  const c = await challenge();
  const receipt = await (await req('/v1/verify', submission(c))).text();
  expect(receipt).not.toContain(key);
});
it('fails closed when durable writes fail', async () => {
  env.DB = {prepare() { return {bind() {return this;}, async run() {return {success:false,meta:{changes:0}};} };} };
  expect((await req('/v1/challenges', {wallet,tableId,variant:'standard'})).status).toBe(503);
});

it('issues a durable challenge, replays, signs the engine score, returns a frontend call', async () => {
  const tables = await (await req('/v1/tables')).json() as any;
  expect(tables.tables).toHaveLength(2);
  const c = await challenge();
  expect(sqlite.prepare('SELECT nonce FROM challenges WHERE nonce = ?').get(c.nonce)).toBeDefined();
  const response = await req('/v1/verify', submission(c));
  expect(response.status).toBe(200);
  const receipt = await response.json() as any;
  expect(receipt.attestation.score).toBe(String(completeProof().score));
  expect(receipt.attestation.wallet.toLowerCase()).toBe(wallet);
  expect(receipt.attestation.tableId).toBe(tableId);
  expect(receipt.call.functionName).toBe('submit');
  expect(receipt.call.args).toEqual([receipt.attestation, receipt.signature]);
  expect(receipt.domain.chainId).toBe(11155111);
  const signer = await recoverTypedDataAddress({domain:receipt.domain, types:receipt.types, primaryType:'Score', message:receipt.attestation, signature:receipt.signature});
  expect(signer).toBe(account.address);
  expect(sqlite.prepare('SELECT consumed FROM challenges WHERE nonce = ?').get(c.nonce)).toMatchObject({consumed:1});
  expect((await req('/v1/verify', submission(c))).status).toBe(409);
});
