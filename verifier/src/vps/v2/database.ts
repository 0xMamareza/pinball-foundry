import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SCHEMA = `CREATE TABLE ranked_runs (
  tx_hash TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, wallet TEXT NOT NULL, table_id TEXT NOT NULL,
  block_hash TEXT NOT NULL, block_number TEXT NOT NULL, expires_at INTEGER NOT NULL,
  result TEXT, score INTEGER, verified_at INTEGER,
  CHECK ((result IS NULL AND score IS NULL AND verified_at IS NULL) OR
         (result IS NOT NULL AND score IS NOT NULL AND verified_at IS NOT NULL))
) STRICT;
CREATE INDEX ranked_best ON ranked_runs(table_id, wallet, score DESC);
CREATE TABLE ranked_metadata (id INTEGER PRIMARY KEY CHECK(id=1), deployment TEXT NOT NULL) STRICT;`;
export type Run = { tx_hash: string; nonce: string; wallet: string; table_id: string; block_hash: string; block_number: string;
  expires_at: number; result: string | null; score: number | null; verified_at: number | null };
export class RankedError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function denied(status: number, message: string): never { throw new RankedError(status, message); }
function validate(db: DatabaseSync) {
  const expected = new DatabaseSync(':memory:');
  try {
    expected.exec(SCHEMA);
    const schema = (d: DatabaseSync) => JSON.stringify(d.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all());
    if (db.prepare('PRAGMA user_version').get()!.user_version !== 2 || schema(db) !== schema(expected) ||
        db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw Error('invalid ranked database');
  } finally { expected.close(); }
}
export function openRankedDatabase(path: string, capacity = 100_000) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_000_000) throw Error('invalid run capacity');
  const existing = existsSync(path);
  if (existing) { const ro = new DatabaseSync(path, { readOnly: true }); try { validate(ro); } finally { ro.close(); } }
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000; PRAGMA journal_size_limit=4194304; PRAGMA wal_autocheckpoint=1000;');
    if (db.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'wal') throw Error('persistent WAL required');
    if (!existing) db.exec(`BEGIN IMMEDIATE; ${SCHEMA} PRAGMA user_version=2; COMMIT;`);
    validate(db);
  } catch (error) { db.close(); throw error; }
  const get = (hash: string) => db.prepare('SELECT * FROM ranked_runs WHERE tx_hash=?').get(hash) as Run | undefined;
  function atomic<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    bind(deployment: string) {
      atomic(() => {
        db.prepare('INSERT OR IGNORE INTO ranked_metadata(id,deployment) VALUES(1,?)').run(deployment);
        if (db.prepare('SELECT deployment FROM ranked_metadata WHERE id=1').get()!.deployment !== deployment) throw Error('database deployment mismatch');
      });
    },
    get,
    start(wallet: string, tableId: string, txHash: string, blockHash: string, blockNumber: string, now: number) {
      return atomic(() => {
        const previous = get(txHash);
        if (previous) {
          if (previous.wallet !== wallet || previous.table_id !== tableId || previous.block_hash !== blockHash || previous.block_number !== blockNumber) denied(409, 'start binding conflict');
          if (previous.result) denied(409, 'run already completed');
          if (previous.expires_at <= now) denied(410, 'run expired');
          return previous;
        }
        if ((db.prepare('SELECT COUNT(*) AS n FROM ranked_runs').get()!.n as number) >= capacity) denied(503, 'run storage full');
        const nonce = '0x' + randomBytes(32).toString('hex');
        db.prepare('INSERT INTO ranked_runs(tx_hash,nonce,wallet,table_id,block_hash,block_number,expires_at) VALUES(?,?,?,?,?,?,?)')
          .run(txHash, nonce, wallet, tableId, blockHash, blockNumber, now + 900);
        return get(txHash)!;
      });
    },
    finish(txHash: string, nonce: string, result: { score: number; proofHash: string }, now: number) {
      return atomic(() => {
        const run = get(txHash);
        if (!run || run.nonce !== nonce) denied(404, 'unknown run');
        if (run.result) {
          const previous = JSON.parse(run.result);
          if (previous.proofHash !== result.proofHash || previous.score !== result.score) denied(409, 'run already consumed by another proof');
          return previous;
        }
        if (run.expires_at <= now) denied(410, 'run expired');
        const receipt = { version: 2, storage: 'offchain', chainId: 11155111, txHash, wallet: run.wallet, tableId: run.table_id,
          score: result.score, proofHash: result.proofHash, verifiedAt: now };
        db.prepare('UPDATE ranked_runs SET result=?,score=?,verified_at=? WHERE tx_hash=? AND result IS NULL')
          .run(JSON.stringify(receipt), result.score, now, txHash);
        return receipt;
      });
    },
    leaderboard(tableId: string) {
      return db.prepare(`SELECT result FROM (
        SELECT result, score, verified_at, tx_hash, ROW_NUMBER() OVER (PARTITION BY wallet ORDER BY score DESC, verified_at, tx_hash) AS rank
        FROM ranked_runs WHERE table_id=? AND result IS NOT NULL
      ) WHERE rank=1 ORDER BY score DESC, verified_at, tx_hash LIMIT 20`).all(tableId).map(row => JSON.parse(row.result as string));
    },
    cleanup(_now: number) { /* Never delete used/expired identities: a start transaction is single-use forever. */ },
    close() { db.close(); },
  };
}
export type RankedDatabase = ReturnType<typeof openRankedDatabase>;
