import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/vps/database';
import { join } from 'node:path';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function path() { const root = process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'hermes/cache/scratch') : tmpdir(); const dir = mkdtempSync(join(root, 'pinball-db-')); dirs.push(dir); return join(dir, 'scores.sqlite'); }

it('refuses a database that cannot enter persistent WAL mode', () => {
  expect(() => { const db = openDatabase(':memory:', 20); db.close(); }).toThrow('persistent WAL storage required');
});

it('caps stored challenges at the SQL boundary and reclaims only expired rows', () => {
  const db = openDatabase(path(), 2);
  try {
    const insert = db.sqlite.prepare("INSERT INTO challenges(nonce,wallet,table_id,variant,expires_at) VALUES(?,'w','t','standard',?)");
    insert.run('expired', 1); insert.run('alive', 2_000_000_000);
    expect(() => insert.run('overflow', 2_000_000_000)).toThrow(/capacity/);
    expect(db.cleanup(2)).toBe(1);
    insert.run('new', 2_000_000_000);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM challenges').get()).toMatchObject({ n: 2 });
  } finally { db.close(); }
});

it.each(['future', 'unversioned', 'drifted', 'corrupt'])('refuses %s databases instead of silently migrating them', (kind) => {
  const file = path();
  const sqlite = new DatabaseSync(file);
  if (kind === 'future') sqlite.exec('PRAGMA user_version=99');
  if (kind === 'unversioned') sqlite.exec('CREATE TABLE challenges(nonce TEXT)');
  if (kind === 'drifted') sqlite.exec('CREATE TABLE challenges(nonce TEXT); PRAGMA user_version=1');
  sqlite.close();
  if (kind === 'corrupt') writeFileSync(file, 'not a sqlite database');
  expect(() => openDatabase(file, 20)).toThrow();
});

it('rejects a foreign rollback-journal database without changing its journal mode or rows', () => {
  const file = path();
  const sqlite = new DatabaseSync(file);
  sqlite.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('keep'); PRAGMA journal_mode=DELETE");
  sqlite.close();
  expect(() => openDatabase(file, 20)).toThrow();
  const reopened = new DatabaseSync(file, { readOnly: true });
  try {
    expect(reopened.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'delete' });
    expect(reopened.prepare('SELECT value FROM unrelated').get()).toMatchObject({ value: 'keep' });
  } finally { reopened.close(); }
});

it('restores a consistent online backup without forgetting a consumed nonce', async () => {
  const source = openDatabase(path(), 20); const target = path();
  try {
    source.sqlite.exec("INSERT INTO challenges VALUES('nonce','wallet','table','standard',2000000000,1)");
    await backup(source.sqlite, target);
    const restored = openDatabase(target, 20);
    try { expect(await restored.prepare('SELECT consumed FROM challenges WHERE nonce=?').bind('nonce').first()).toMatchObject({ consumed: 1 }); } finally { restored.close(); }
  } finally { source.close(); }
});

it('migrates a file-backed WAL database once and preserves challenges after reopening', async () => {
  const module = await import('../src/vps/database').catch(() => null);
  expect(module, 'durable VPS database adapter is not implemented').not.toBeNull();
  const file = path();
  const first = module!.openDatabase(file, 20);
  expect(first.sqlite.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
  expect(first.sqlite.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
  await first.prepare('INSERT INTO challenges(nonce,wallet,table_id,variant,expires_at) VALUES(?,?,?,?,?)')
    .bind('nonce', 'wallet', 'table', 'standard', 2_000_000_000).run();
  first.close();
  const second = module!.openDatabase(file, 20);
  try {
    expect(await second.prepare('SELECT * FROM challenges WHERE nonce = ?').bind('nonce').first()).toMatchObject({ nonce: 'nonce', consumed: 0 });
  } finally { second.close(); }
});
