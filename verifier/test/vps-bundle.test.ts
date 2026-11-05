import { expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { privateKeyToAccount } from 'viem/accounts';

it('builds byte-identical portable production bundles and runs without node_modules across process restart', async () => {
  const build = () => spawnSync(process.execPath, ['scripts/build-vps.mjs'], { encoding: 'utf8' });
  const first = build(); expect(first.status, first.stderr).toBe(0);
  const artifact = new URL('../dist/vps/server.mjs', import.meta.url);
  const bytes = readFileSync(artifact);
  const second = build(); expect(second.status, second.stderr).toBe(0);
  expect(readFileSync(artifact).equals(bytes)).toBe(true);
  const notices = readFileSync(new URL('../dist/vps/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');
  expect(notices).toContain('Copyright (c) 2023-present weth, LLC');
  expect(notices).toContain('Copyright (c) 2022 Paul Miller');
  expect(notices).toContain('Permission is hereby granted, free of charge');
  expect(notices).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  const manifest = JSON.parse(readFileSync(new URL('../dist/vps/manifest.json', import.meta.url), 'utf8'));
  expect(manifest.noticesSha256).toBe(createHash('sha256').update(notices).digest('hex'));
  for (const name of ['viem', '@noble/curves', '@noble/hashes', 'ox']) expect(manifest.packages).toContain(name);
  for (const name of manifest.packages) expect(notices).toContain(`${name}@`);
  const root = process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'hermes/cache/scratch') : tmpdir();
  const dir = mkdtempSync(join(root, 'pinball-bundle-'));
  copyFileSync(artifact, join(dir, 'server.mjs'));
  const key = '0x' + '11'.repeat(32); // Disposable public test key, never funded.
  writeFileSync(join(dir, 'key'), key, { mode: 0o600 });
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', ALLOWED_ORIGIN: 'https://game.example',
    DATABASE_PATH: join(dir, 'db.sqlite'), VERIFIER_PRIVATE_KEY_FILE: join(dir, 'key'), VERIFIER_PRIVATE_KEY: undefined,
    VERIFIER_ADDRESS: privateKeyToAccount(key as `0x${string}`).address,
    CHAIN_ID: '11155111', LEADERBOARD_ADDRESS: '0x000000000000000000000000000000000000beef' };
  let child: ChildProcess | undefined;
  let logs = '';
  async function stop() { if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; if (process.platform !== 'win32') expect(child.exitCode).toBe(0); } }
  async function launch() {
    child = spawn(process.execPath, ['server.mjs'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout!.on('data', chunk => { text += chunk.toString(); logs += chunk.toString(); });
    child.stderr!.on('data', chunk => { logs += chunk.toString(); });
    const deadline = Date.now() + 5_000;
    while (!text.includes('"event":"listening"')) {
      if (child.exitCode !== null || Date.now() >= deadline) throw Error(`bundle did not become ready: ${logs}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const ready = JSON.parse(text.trim().split('\n').find(line => line.includes('"event":"listening"'))!);
    expect(ready.host).toBe('127.0.0.1'); return ready.port as number;
  }
  function http(port: number, path: string, body?: unknown) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers: { Host: 'game.example', 'Content-Type': 'application/json' } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
      }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  try {
    const port = await launch();
    const tables = await http(port, '/v1/tables'); expect(tables.status).toBe(200);
    const challenge = await http(port, '/v1/challenges', { wallet: '0x00000000000000000000000000000000000000a1', tableId: tables.body.tables[0].tableId, variant: 'standard' });
    expect(challenge.status).toBe(201);
    await stop();
    const restartedPort = await launch(); expect((await http(restartedPort, '/v1/tables')).status).toBe(200);
    const sqlite = new DatabaseSync(env.DATABASE_PATH, { readOnly: true });
    try { expect(sqlite.prepare('SELECT nonce FROM challenges WHERE nonce=?').get(challenge.body.nonce)).toMatchObject({ nonce: challenge.body.nonce }); } finally { sqlite.close(); }
    await stop();
    const invalid = spawnSync(process.execPath, ['server.mjs'], { cwd: dir, env: { ...env, HOST: '0.0.0.0' }, encoding: 'utf8', timeout: 5_000 });
    expect(invalid.status).toBe(1); expect(invalid.stderr).toContain('verifier startup failed');
    expect(logs + invalid.stderr + invalid.stdout).not.toContain(key);
    if (process.platform !== 'win32') expect(logs).toContain('"event":"stopped"');
    console.log(JSON.stringify({ portableBundle: true, node: process.version, sha256: createHash('sha256').update(bytes).digest('hex'), processRestartPersistence: true }));
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
