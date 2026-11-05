import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { isAddress, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export function assertRuntime(version: string) {
  const match = /^24\.(\d+)\.\d+$/.exec(version);
  if (!match || Number(match[1]) < 20) throw Error('unsupported runtime');
}

export function loadConfiguration(settings: NodeJS.ProcessEnv) {
  try {
    const integer = (name: string, fallback: number, min: number, max: number) => {
      const raw = settings[name] ?? String(fallback);
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw Error();
      return value;
    };
    const origin = new URL(settings.ALLOWED_ORIGIN!);
    if ((settings.HOST ?? '127.0.0.1') !== '127.0.0.1' || origin.origin !== settings.ALLOWED_ORIGIN ||
        !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) ||
        !settings.DATABASE_PATH || !isAbsolute(settings.DATABASE_PATH) || settings.CHAIN_ID !== '11155111' ||
        !isAddress(settings.LEADERBOARD_ADDRESS ?? '') || settings.LEADERBOARD_ADDRESS!.toLowerCase() === zeroAddress ||
        !isAddress(settings.VERIFIER_ADDRESS ?? '') || settings.VERIFIER_PRIVATE_KEY) throw Error();
    const keyFile = settings.VERIFIER_PRIVATE_KEY_FILE;
    if (!keyFile || !isAbsolute(keyFile)) throw Error();
    const stat = lstatSync(keyFile);
    if (!stat.isFile() || stat.size > 100 || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw Error();
    const key = readFileSync(keyFile, 'utf8').trim() as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key) || privateKeyToAccount(key).address.toLowerCase() !== settings.VERIFIER_ADDRESS!.toLowerCase()) throw Error();
    return {
      databasePath: settings.DATABASE_PATH, port: integer('PORT', 3217, 0, 65535), host: origin.host,
      rateLimit: integer('RATE_LIMIT', 120, 1, 10_000), rateWindowMs: integer('RATE_WINDOW_MS', 60_000, 100, 3_600_000),
      maxInflight: integer('MAX_INFLIGHT', 4, 1, 16), maxConnections: integer('MAX_CONNECTIONS', 32, 1, 128),
      bodyTimeoutMs: integer('BODY_TIMEOUT_MS', 10_000, 100, 30_000),
      maxChallenges: integer('MAX_CHALLENGES', 20_000, 1, 100_000),
      cleanupIntervalMs: integer('CLEANUP_INTERVAL_MS', 60_000, 100, 300_000),
      shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 5_000, 100, 30_000),
      env: { VERIFIER_PRIVATE_KEY: key, VERIFIER_ADDRESS: settings.VERIFIER_ADDRESS!, LEADERBOARD_ADDRESS: settings.LEADERBOARD_ADDRESS!,
        CHAIN_ID: settings.CHAIN_ID!, ALLOWED_ORIGIN: origin.origin },
    };
  } catch { throw Error('invalid verifier configuration'); }
}
