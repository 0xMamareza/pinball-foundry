import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import migration from '../../migrations/0001.sql?raw';

function validate(sqlite: DatabaseSync) {
  if (sqlite.prepare('PRAGMA user_version').get()!.user_version !== 1) throw Error('unsupported database version');
  const objects = sqlite.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name != 'challenges_capacity' ORDER BY name").all();
  const expected = new DatabaseSync(':memory:');
  try {
    expected.exec(migration);
    const schema = expected.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    if (JSON.stringify(objects) !== JSON.stringify(schema)) throw Error('database schema mismatch');
  } finally { expected.close(); }
  if (sqlite.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw Error('database integrity check failed');
}

/** D1's structural subset; writes stay single SQLite statements. */
export function openDatabase(path: string, maxChallenges: number) {
  if (!Number.isSafeInteger(maxChallenges) || maxChallenges < 1 || maxChallenges > 100_000) throw Error('invalid challenge capacity');
  const existing = existsSync(path);
  if (existing) {
    const readonly = new DatabaseSync(path, { readOnly: true });
    try { validate(readonly); } finally { readonly.close(); }
  }
  const sqlite = new DatabaseSync(path);
  try {
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000;');
    if (sqlite.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'wal') throw Error('persistent WAL storage required');
    if (!existing) sqlite.exec(`BEGIN IMMEDIATE; ${migration} PRAGMA user_version=1; COMMIT;`);
    validate(sqlite);
    sqlite.exec('PRAGMA journal_size_limit=4194304; PRAGMA wal_autocheckpoint=1000;');
    sqlite.exec(`DROP TRIGGER IF EXISTS challenges_capacity;
      CREATE TRIGGER challenges_capacity BEFORE INSERT ON challenges
      WHEN (SELECT COUNT(*) FROM challenges) >= ${maxChallenges}
      BEGIN SELECT RAISE(ABORT, 'challenge capacity exceeded'); END;`);
  } catch (error) { sqlite.close(); throw error; }
  return {
    sqlite,
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let args: (string | number)[] = [];
      return {
        bind(...values: (string | number)[]) { args = values; return this; },
        async first<T>(): Promise<T | null> { return (statement.get(...args) as T | undefined) ?? null; },
        async run() { const result = statement.run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    },
    cleanup(now: number) { return Number(sqlite.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(now).changes); },
    close() { sqlite.close(); },
  };
}
