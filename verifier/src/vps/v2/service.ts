import { getAddress, isAddress, recoverMessageAddress, zeroAddress } from 'viem';
import { exactObject, MAX_STEPS, officialTables, replay, RULESET } from '../../replay';
import { denied, RankedError, type RankedDatabase } from './database';
export { openRankedDatabase } from './database';
export interface StartChain {
  verify(wallet: string, tableId: string, txHash: string, fresh: boolean): Promise<{ blockHash: string; blockNumber: string }>;
}
const now = () => Math.floor(Date.now() / 1000);
const hash = (value: unknown): value is `0x${string}` => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
export function startMessage(b: { wallet: string; tableId: string; txHash: string; contract: string }) {
  return `Pinball Foundry ranked start v2\nChain: 11155111\nContract: ${b.contract.toLowerCase()}\nWallet: ${b.wallet.toLowerCase()}\nTable: ${b.tableId}\nTransaction: ${b.txHash}\nRuleset: ${RULESET}`;
}
async function json(request: Request, keys: string[]) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || request.headers.has('Content-Encoding')) denied(415, 'use uncompressed application/json');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 300_000) denied(413, 'body too large');
  try { const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); exactObject(raw, keys); return raw; }
  catch { return denied(400, 'invalid request fields'); }
}
export function createRankedService(db: RankedDatabase, chain: StartChain, config: { contract: string; confirmations: number; origin?: string }) {
  db.bind(JSON.stringify({ chainId: 11155111, contract: config.contract.toLowerCase(), ruleset: RULESET, tables: officialTables().map(t => t.tableId) }));
  async function route(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === '/v2/tables') {
      if (request.method !== 'GET') denied(405, 'method not allowed');
      return { status: 200, body: { version: 2, storage: 'offchain', ruleset: RULESET, maxSteps: MAX_STEPS, tables: officialTables(),
        chainId: 11155111, startContract: config.contract, confirmations: config.confirmations, authorization: 'personal_sign', runSeconds: 900 } };
    }
    if (url.pathname === '/v2/leaderboard') {
      if (request.method !== 'GET') denied(405, 'method not allowed');
      const tableId = url.searchParams.get('tableId');
      if (!officialTables().some(t => t.tableId === tableId) || [...url.searchParams.keys()].some(k => k !== 'tableId') || url.searchParams.getAll('tableId').length !== 1) denied(400, 'invalid official table');
      return { status: 200, body: { version: 2, storage: 'offchain', tableId, entries: db.leaderboard(tableId!) } };
    }
    if (!['/v2/runs', '/v2/scores'].includes(url.pathname)) denied(404, 'not found');
    if (request.method !== 'POST') denied(405, 'method not allowed');
    if (url.pathname === '/v2/runs') {
      const raw = await json(request, ['wallet', 'tableId', 'txHash', 'signature']);
      if (typeof raw.wallet !== 'string' || !isAddress(raw.wallet) || raw.wallet.toLowerCase() === zeroAddress ||
          !hash(raw.txHash) || typeof raw.tableId !== 'string' || !officialTables().some(t => t.tableId === raw.tableId) ||
          typeof raw.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(raw.signature)) denied(400, 'invalid start binding');
      const bound = { wallet: getAddress(raw.wallet), tableId: raw.tableId, txHash: raw.txHash, contract: config.contract };
      let recovered: string;
      try { recovered = await recoverMessageAddress({ message: startMessage(bound), signature: raw.signature as `0x${string}` }); }
      catch { return denied(403, 'invalid wallet authorization'); }
      if (recovered.toLowerCase() !== bound.wallet.toLowerCase()) denied(403, 'invalid wallet authorization');
      const previous = db.get(bound.txHash);
      if (previous && (previous.wallet !== bound.wallet.toLowerCase() || previous.table_id !== bound.tableId)) denied(409, 'start binding conflict');
      let block;
      try { block = await chain.verify(bound.wallet, bound.tableId, bound.txHash, !previous); }
      catch (error) {
        // Another request may admit this transaction while the fresh RPC check is in flight.
        const concurrent = db.get(bound.txHash);
        if (previous || !(error instanceof RankedError) || error.status !== 410 || !concurrent) throw error;
        if (concurrent.wallet !== bound.wallet.toLowerCase() || concurrent.table_id !== bound.tableId) denied(409, 'start binding conflict');
        block = await chain.verify(bound.wallet, bound.tableId, bound.txHash, false);
      }
      const run = db.start(bound.wallet.toLowerCase(), bound.tableId, bound.txHash, block.blockHash, block.blockNumber, now());
      return { status: 201, body: { version: 2, storage: 'offchain', nonce: run.nonce, wallet: run.wallet, tableId: run.table_id,
        txHash: run.tx_hash, expiresAt: run.expires_at, ruleset: RULESET, maxSteps: MAX_STEPS } };
    }
    const raw = await json(request, ['nonce', 'txHash', 'score', 'proof']);
    if (!hash(raw.nonce) || !hash(raw.txHash) || !Number.isSafeInteger(raw.score) || (raw.score as number) < 0) denied(400, 'invalid submission');
    const run = db.get(raw.txHash);
    if (!run || run.nonce !== raw.nonce) denied(404, 'unknown run');
    if (!run.result && run.expires_at <= now()) denied(410, 'run expired');
    const block = await chain.verify(run.wallet, run.table_id, run.tx_hash, false);
    if (block.blockHash !== run.block_hash || block.blockNumber !== run.block_number) denied(409, 'start transaction reorganized');
    let result: ReturnType<typeof replay>;
    try { result = replay(run.table_id, 'standard', raw.proof); } catch { return denied(400, 'invalid or unfinished replay'); }
    if (result.score !== raw.score) denied(400, 'claimed score does not match replay');
    return { status: 200, body: db.finish(raw.txHash, raw.nonce, result, now()) };
  }
  return async (request: Request) => {
    const origin = request.headers.get('Origin');
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin && origin === config.origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    try {
      if (origin && origin !== config.origin) denied(403, 'origin not allowed');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      const { status, body } = await route(request);
      return Response.json(body, { status, headers });
    } catch (error) { return Response.json({ error: error instanceof RankedError ? error.message : 'ranked service unavailable' }, { status: error instanceof RankedError ? error.status : 503, headers }); }
  };
}
