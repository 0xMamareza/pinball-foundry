import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { privateKeyToAccount } from 'viem/accounts';
import { completeProof } from './helpers';
import { officialTables, replay } from '../src/replay';
import { createGame, launch, step } from '../../src/engine';
import { TABLES } from '../../src/layout';
import { DatabaseSync } from 'node:sqlite';

const dirs: string[] = [];
const closes: (() => void)[] = [];
afterEach(() => { for (const close of closes.splice(0)) close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const account = privateKeyToAccount(('0x' + '11'.repeat(32)) as `0x${string}`);
const contract = '0x000000000000000000000000000000000000beef';
const txHash = ('0x' + '12'.repeat(32)) as `0x${string}`;
async function setup() {
  const mod = await import('../src/vps/v2/service').catch(() => null);
  expect(mod, 'automatic offchain ranked service is missing').not.toBeNull();
  const dir = mkdtempSync(join(process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'hermes/cache/scratch') : tmpdir(), 'pinball-v2-')); dirs.push(dir);
  const path = join(dir, 'ranked.sqlite');
  const tableId = officialTables()[0].tableId;
  const db = mod!.openRankedDatabase(path); closes.push(() => db.close());
  const chain = { async verify() { return { blockHash: '0x' + '34'.repeat(32), blockNumber: '0x10' }; } };
  const service = mod!.createRankedService(db, chain, { contract, confirmations: 3 });
  const signature = await account.signMessage({ message: mod!.startMessage({ wallet: account.address, tableId, txHash, contract }) });
  const body = { wallet: account.address, tableId, txHash, signature };
  const call = async (path: string, body?: unknown) => {
    const r = await service(new Request('https://game.example' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, body: await r.json() as any };
  };
  return { mod: mod!, db, path, tableId, body, call, chain };
}
it('refuses reuse of a ranked DB with a different deployment identity', async () => {
  const s = await setup();
  expect(() => s.mod.createRankedService(s.db, s.chain, { contract: '0x000000000000000000000000000000000000cafe', confirmations: 3 })).toThrow('database deployment mismatch');
});
it('binds an authenticated start, replay-verifies, persists and idempotently returns an OFFCHAIN result', async () => {
  const s = await setup();
  const started = await s.call('/v2/runs', s.body);
  expect(started.status).toBe(201);
  const { proof, score } = completeProof();
  const result = await s.call('/v2/scores', { nonce: started.body.nonce, txHash, score, proof });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ version: 2, storage: 'offchain', score, txHash, wallet: account.address.toLowerCase(), proofHash: replay(s.tableId, 'standard', proof).proofHash });
  expect((await s.call('/v2/leaderboard?tableId=' + s.tableId)).body.entries).toHaveLength(1);
  expect((await s.call('/v2/scores', { nonce: started.body.nonce, txHash, score, proof })).body).toEqual(result.body);
  closes.pop()!();
  const reopened = s.mod.openRankedDatabase(s.path); closes.push(() => reopened.close());
  expect(reopened.leaderboard(s.tableId)).toHaveLength(1);
  const restarted = s.mod.createRankedService(reopened, s.chain, { contract, confirmations: 3 });
  const response = await restarted(new Request('https://game.example/v2/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce: started.body.nonce, txHash, score, proof }) }));
  expect(await response.json()).toEqual(result.body);
});
it('denies forged wallet/table/transaction authorization and does not create a run', async () => {
  const s = await setup();
  for (const change of [{ wallet: '0x00000000000000000000000000000000000000a1' }, { tableId: officialTables()[1].tableId },
    { txHash: '0x' + 'ff'.repeat(32) }, { signature: '0x' + '00'.repeat(65) }]) {
    expect((await s.call('/v2/runs', { ...s.body, ...change })).status).toBe(403);
  }
  expect(s.db.get(txHash)).toBeUndefined();
});
it('rejects forged scores, unfinished/changed proofs, missing nonce and failed chain without consuming the run', async () => {
  const s = await setup();
  const started = await s.call('/v2/runs', s.body);
  const { proof, score } = completeProof();
  const valid = { nonce: started.body.nonce, txHash, score, proof };
  for (const change of [{ score: score + 1 }, { proof: { ...proof, inputs: [0] } }, { proof: { ...proof, inputs: [...proof.inputs, 0] } },
    { proof: { ...proof, charge: 3 } }, { score: -1 }]) expect((await s.call('/v2/scores', { ...valid, ...change })).status).toBe(400);
  expect((await s.call('/v2/scores', { ...valid, nonce: '0x' + 'ff'.repeat(32) })).status).toBe(404);
  const verify = s.chain.verify;
  s.chain.verify = async () => { throw Error('RPC unavailable'); };
  expect((await s.call('/v2/scores', valid)).status).toBe(503);
  s.chain.verify = async () => ({ blockHash: '0x' + 'ff'.repeat(32), blockNumber: '0x10' });
  expect((await s.call('/v2/scores', valid)).status).toBe(409);
  s.chain.verify = verify;
  expect(s.db.get(txHash)!.result).toBeNull();
  expect((await s.call('/v2/scores', valid)).status).toBe(200);
});
function alternativeProof() {
  const game = createGame(TABLES[0].parts, null);
  const inputs: number[] = []; const launches: { step: number; power: number }[] = [];
  while (game.status !== 'over' && inputs.length < 72000) {
    if (game.status === 'ready') { launches.push({ step: inputs.length, power: 0 }); launch(game, 0); }
    inputs.push(0); step(game, { left: false, right: false });
  }
  return { proof: { version: 1, inputs, launches }, score: game.score };
}
it('serializes parallel starts and identical scores; conflicting valid proof cannot overwrite the consumed transaction', async () => {
  const s = await setup();
  const starts = await Promise.all(Array.from({ length: 4 }, () => s.call('/v2/runs', s.body)));
  expect(starts.map(r => r.status)).toEqual([201, 201, 201, 201]);
  expect(new Set(starts.map(r => r.body.nonce)).size).toBe(1);
  const { proof, score } = completeProof();
  const a = { nonce: starts[0].body.nonce, txHash, score, proof };
  const b = { ...a, ...alternativeProof() };
  const responses = await Promise.all([s.call('/v2/scores', a), s.call('/v2/scores', a), s.call('/v2/scores', b)]);
  expect(responses.map(r => r.status)).toEqual([200, 200, 409]);
  expect((await s.call('/v2/leaderboard?tableId=' + s.tableId)).body.entries).toHaveLength(1);
  expect((await s.call('/v2/runs', s.body)).status).toBe(409);
});
it('keeps expired start tombstones and enforces storage capacity instead of permitting transaction reuse', async () => {
  const s = await setup();
  const started = await s.call('/v2/runs', s.body);
  const raw = new DatabaseSync(s.path);
  try { raw.prepare('UPDATE ranked_runs SET expires_at=1').run(); } finally { raw.close(); }
  expect((await s.call('/v2/runs', s.body)).status).toBe(410);
  expect((await s.call('/v2/scores', { txHash, nonce: started.body.nonce, ...completeProof() })).status).toBe(410);
  s.db.cleanup(2_000_000_000);
  expect(s.db.get(txHash)).toBeDefined();
  const small = s.mod.openRankedDatabase(join(dirs[dirs.length - 1], 'small.sqlite'), 1); closes.push(() => small.close());
  small.start('w', s.tableId, txHash, 'b', '0x1', 100);
  expect(() => small.start('w', s.tableId, 'second', 'b', '0x1', 100)).toThrow('run storage full');
});
it('ranks only best score per wallet per table and returns deterministic top 20', async () => {
  const s = await setup();
  for (let i = 0; i < 25; i++) {
    const r = s.db.start('wallet-' + i, s.tableId, 'tx-' + i, 'block', '0x1', 100);
    s.db.finish(r.tx_hash, r.nonce, { score: i, proofHash: 'proof-' + i }, 101);
  }
  const better = s.db.start('wallet-0', s.tableId, 'better', 'b', '0x1', 100);
  s.db.finish(better.tx_hash, better.nonce, { score: 50, proofHash: 'better' }, 101);
  const rows = s.db.leaderboard(s.tableId);
  expect(rows).toHaveLength(20);
  expect(rows[0]).toMatchObject({ wallet: 'wallet-0', score: 50 });
  expect(rows.map(r => r.score)).toEqual([50, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  expect(s.db.leaderboard(officialTables()[1].tableId)).toEqual([]);
});
