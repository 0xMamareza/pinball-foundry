import { getAddress, isAddress, toHex, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { exactObject, officialTables, replay, MAX_STEPS, RULESET } from './replay';
import { scoreDomain, scoreTypes, type Attestation } from './typed-data';

// Minimal structural subset of the Cloudflare D1 API. No in-memory production fallback.
interface Statement {
  bind(...values: (string | number)[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
}
export interface Env {
  DB: { prepare(sql: string): Statement };
  VERIFIER_PRIVATE_KEY: Hex; // Worker secret, never a frontend variable.
  VERIFIER_ADDRESS: string;
  LEADERBOARD_ADDRESS: string;
  CHAIN_ID: string;
  ALLOWED_ORIGIN: string;
}
type Challenge = { nonce: Hex; wallet: string; table_id: Hex; variant: string; expires_at: number; consumed: number };
const MAX_BODY_BYTES = 300_000;
const CHALLENGE_SECONDS = 900;
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new ApiError(status, message); }
const now = () => Math.floor(Date.now() / 1000);
function configuration(env: Env) {
  const chainId = Number(env.CHAIN_ID);
  let origin: URL;
  try { origin = new URL(env.ALLOWED_ORIGIN); } catch { return fail(503, 'verifier not configured'); }
  if (!env.DB || env.CHAIN_ID !== '11155111' ||
      !isAddress(env.LEADERBOARD_ADDRESS ?? '') || env.LEADERBOARD_ADDRESS.toLowerCase() === zeroAddress ||
      !isAddress(env.VERIFIER_ADDRESS ?? '') || !/^0x[0-9a-fA-F]{64}$/.test(env.VERIFIER_PRIVATE_KEY ?? '') ||
      !['http:', 'https:'].includes(origin.protocol) || origin.origin !== env.ALLOWED_ORIGIN) fail(503, 'verifier not configured');
  const account = privateKeyToAccount(env.VERIFIER_PRIVATE_KEY);
  if (account.address.toLowerCase() !== env.VERIFIER_ADDRESS.toLowerCase()) fail(503, 'verifier not configured');
  return { account, domain: scoreDomain(chainId, getAddress(env.LEADERBOARD_ADDRESS)) };
}
async function boundedJson(request: Request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
      request.headers.has('Content-Encoding')) fail(415, 'use uncompressed application/json');
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) fail(413, 'body too large');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'missing body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) { await reader.cancel(); fail(413, 'body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { return fail(400, 'invalid JSON'); }
}
function binding(body: Record<string, unknown>) {
  if (typeof body.wallet !== 'string' || !isAddress(body.wallet) || body.wallet.toLowerCase() === zeroAddress ||
      typeof body.tableId !== 'string' || !officialTables().some(t => t.tableId === body.tableId) ||
      body.variant !== 'standard') fail(400, 'invalid wallet, official table or variant');
  return { wallet: getAddress(body.wallet), tableId: body.tableId as Hex, variant: 'standard' };
}
async function route(request: Request, env: Env): Promise<{ status: number; body: unknown }> {
  const path = new URL(request.url).pathname;
  if (path === '/v1/tables') {
    if (request.method !== 'GET') fail(405, 'method not allowed');
    return { status: 200, body: { version: 1, ruleset: RULESET, maxSteps: MAX_STEPS, tables: officialTables() } };
  }
  if (!['/v1/challenges', '/v1/verify'].includes(path)) fail(404, 'not found');
  if (request.method !== 'POST') fail(405, 'method not allowed');
  const config = configuration(env);
  const raw = await boundedJson(request);
  try { exactObject(raw, path === '/v1/challenges' ? ['wallet', 'tableId', 'variant'] : ['nonce', 'wallet', 'tableId', 'variant', 'proof']); }
  catch { return fail(400, 'invalid request fields'); }
  const bound = binding(raw);
  if (path === '/v1/challenges') {
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = now() + CHALLENGE_SECONDS;
    const result = await env.DB.prepare('INSERT INTO challenges(nonce,wallet,table_id,variant,expires_at) VALUES(?,?,?,?,?)')
      .bind(nonce, bound.wallet.toLowerCase(), bound.tableId, bound.variant, expiresAt).run();
    if (!result.success || result.meta.changes !== 1) fail(503, 'challenge storage unavailable');
    return { status: 201, body: { version: 1, nonce, ...bound, expiresAt, ruleset: RULESET, maxSteps: MAX_STEPS, domain: config.domain } };
  }
  if (typeof raw.nonce !== 'string' || !/^0x[0-9a-f]{64}$/.test(raw.nonce)) fail(400, 'invalid nonce');
  const challenge = await env.DB.prepare('SELECT * FROM challenges WHERE nonce = ?').bind(raw.nonce).first<Challenge>();
  if (!challenge) fail(404, 'unknown challenge');
  if (challenge.consumed) fail(409, 'challenge already consumed');
  if (challenge.expires_at <= now()) fail(410, 'challenge expired');
  if (challenge.wallet !== bound.wallet.toLowerCase() || challenge.table_id !== bound.tableId || challenge.variant !== bound.variant) fail(400, 'challenge binding mismatch');
  let result: ReturnType<typeof replay>;
  try { result = replay(bound.tableId, bound.variant, raw.proof); }
  catch { return fail(400, 'invalid or unfinished replay'); }
  const attestation: Attestation = { wallet: bound.wallet, tableId: bound.tableId, score: BigInt(result.score),
    nonce: challenge.nonce, expiresAt: BigInt(challenge.expires_at), proofHash: result.proofHash };
  const signature = await config.account.signTypedData({ domain: config.domain, types: scoreTypes, primaryType: 'Score', message: attestation });
  // The single conditional D1 write is the cross-isolate concurrency/replay gate.
  const claimed = await env.DB.prepare('UPDATE challenges SET consumed = 1 WHERE nonce = ? AND consumed = 0 AND expires_at > ?')
    .bind(challenge.nonce, now()).run();
  if (!claimed.success) fail(503, 'challenge storage unavailable');
  if (claimed.meta.changes !== 1) fail(409, 'challenge consumed or expired during verification');
  const receipt = { ...attestation, score: attestation.score.toString(), expiresAt: attestation.expiresAt.toString() };
  return { status: 200, body: { version: 1, attestation: receipt, signature, domain: config.domain, types: scoreTypes,
    steps: result.steps, call: { address: config.domain.verifyingContract, chainId: config.domain.chainId, functionName: 'submit', args: [receipt, signature] } } };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin && origin === env.ALLOWED_ORIGIN) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
    }
    try {
      if (origin && origin !== env.ALLOWED_ORIGIN) fail(403, 'origin not allowed');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      const { status, body } = await route(request, env);
      return Response.json(body, { status, headers });
    } catch (error) {
      const known = error instanceof ApiError;
      return Response.json({ error: known ? error.message : 'verifier unavailable' }, { status: known ? error.status : 503, headers });
    }
  },
};
