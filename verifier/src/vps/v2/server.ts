import { isAbsolute } from 'node:path';
import { isAddress, zeroAddress } from 'viem';
import { startHttpService } from '../server';
import { createStartChain, createRpc } from './chain';
import { createRankedService, openRankedDatabase } from './service';

export function loadRankedConfiguration(settings: NodeJS.ProcessEnv) {
  try {
    const integer = (name: string, fallback: number, min: number, max: number) => {
      const raw = settings[name] ?? String(fallback); const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw Error();
      return value;
    };
    const origin = new URL(settings.ALLOWED_ORIGIN!);
    const rpc = new URL(settings.SEPOLIA_RPC_URL!);
    const safeUrl = (u: URL) => !u.username && !u.password && !u.hash &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)));
    if (!safeUrl(origin) || origin.origin !== settings.ALLOWED_ORIGIN || !safeUrl(rpc) ||
        (settings.HOST ?? '127.0.0.1') !== '127.0.0.1' || settings.CHAIN_ID !== '11155111' ||
        !settings.DATABASE_PATH || !isAbsolute(settings.DATABASE_PATH) ||
        !isAddress(settings.START_CONTRACT_ADDRESS ?? '') || settings.START_CONTRACT_ADDRESS!.toLowerCase() === zeroAddress ||
        settings.VERIFIER_PRIVATE_KEY || settings.VERIFIER_PRIVATE_KEY_FILE || settings.VERIFIER_ADDRESS || settings.LEADERBOARD_ADDRESS) throw Error();
    return {
      origin: origin.origin, rpc: rpc.href, contract: settings.START_CONTRACT_ADDRESS!,
      confirmations: integer('CONFIRMATIONS', 3, 1, 128), databasePath: settings.DATABASE_PATH,
      maxRuns: integer('MAX_RUNS', 100_000, 1, 1_000_000),
      host: origin.host, port: integer('PORT', 3218, 0, 65535), rateLimit: integer('RATE_LIMIT', 120, 1, 10_000),
      rateWindowMs: integer('RATE_WINDOW_MS', 60_000, 100, 3_600_000), maxInflight: integer('MAX_INFLIGHT', 4, 1, 16),
      maxConnections: integer('MAX_CONNECTIONS', 32, 1, 128), bodyTimeoutMs: integer('BODY_TIMEOUT_MS', 10_000, 100, 30_000),
      cleanupIntervalMs: integer('CLEANUP_INTERVAL_MS', 60_000, 100, 300_000), shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 5_000, 100, 30_000),
    };
  } catch { throw Error('invalid ranked configuration'); }
}
export async function startRankedService(settings: NodeJS.ProcessEnv) {
  const config = loadRankedConfiguration(settings);
  const db = openRankedDatabase(config.databasePath, config.maxRuns);
  const abort = new AbortController();
  const chain = createStartChain(createRpc(config.rpc, abort.signal), config);
  let handler: ReturnType<typeof createRankedService>;
  try { handler = createRankedService(db, chain, config); } catch (error) { db.close(); throw error; }
  const service = await startHttpService(config, handler, db, config.origin);
  return { ...service, close() { abort.abort(); return service.close(); } };
}
