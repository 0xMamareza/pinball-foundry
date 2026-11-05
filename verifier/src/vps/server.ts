import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import worker, { type Env } from '../worker';
import { openDatabase } from './database';
import { loadConfiguration } from './configuration';

const MAX_BODY_BYTES = 300_000;
class TransportError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function readBody(incoming: IncomingMessage, timeoutMs: number): Promise<Buffer> {
  const declared = incoming.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new TransportError(413, 'body too large');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => { clearTimeout(timer); incoming.off('data', data); incoming.off('end', end); incoming.off('error', error); incoming.off('aborted', aborted); incoming.pause(); };
    const error = (error: Error) => { cleanup(); reject(error); };
    const aborted = () => error(new TransportError(400, 'request aborted'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return error(new TransportError(413, 'body too large'));
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
    const timer = setTimeout(() => error(new TransportError(408, 'body timeout')), timeoutMs);
    timer.unref();
    incoming.on('data', data).once('end', end).once('error', error).once('aborted', aborted);
  });
}

export async function startService(settings: NodeJS.ProcessEnv) {
  const config = loadConfiguration(settings);
  const db = openDatabase(config.databasePath, config.maxChallenges);
  const env: Env = { ...config.env, DB: db };
  return startHttpService(config, request => worker.fetch(request, env), db, env.ALLOWED_ORIGIN);
}

export type HttpConfiguration = Pick<ReturnType<typeof loadConfiguration>, 'host' | 'port' | 'rateLimit' | 'rateWindowMs' |
  'maxInflight' | 'maxConnections' | 'bodyTimeoutMs' | 'cleanupIntervalMs' | 'shutdownTimeoutMs'>;
/** Shared hardened loopback transport; v1 signer and v2 offchain storage stay separate. */
export async function startHttpService(config: HttpConfiguration, handler: (request: Request) => Promise<Response>,
  db: { cleanup(now: number): unknown; close(): void }, origin: string) {
  try { db.cleanup(Math.floor(Date.now() / 1000)); } catch (error) { db.close(); throw error; }
  let storageHealthy = true;
  const maintenance = setInterval(() => {
    try { db.cleanup(Math.floor(Date.now() / 1000)); } catch { storageHealthy = false; }
  }, config.cleanupIntervalMs);
  maintenance.unref();
  let tokens = config.rateLimit;
  let lastRefill = performance.now();
  let active = 0;
  let stopping = false;
  let resolveIdle: (() => void) | undefined;
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: config.bodyTimeoutMs + 10_000,
    connectionsCheckingInterval: 1_000, keepAliveTimeout: 1_000 }, async (incoming, outgoing) => {
    incoming.on('error', () => {});
    const reject = (status: number, error: string) => {
      if (outgoing.destroyed) return;
      outgoing.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
      outgoing.end(JSON.stringify({ error }));
    };
    const time = performance.now();
    tokens = Math.min(config.rateLimit, tokens + (time - lastRefill) * config.rateLimit / config.rateWindowMs);
    lastRefill = time;
    if (tokens < 1) { outgoing.setHeader('Retry-After', Math.max(1, Math.ceil((1 - tokens) * config.rateWindowMs / config.rateLimit / 1000))); return reject(429, 'rate limit exceeded'); }
    tokens--;
    if (!storageHealthy || stopping) return reject(503, 'verifier unavailable');
    const hostCount = incoming.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'host').length;
    if (hostCount !== 1) return reject(400, 'invalid host headers');
    if (incoming.headers.host !== config.host) return reject(421, 'host not allowed');
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//') || incoming.url.includes('\\')) return reject(400, 'invalid request target');
    if (active >= config.maxInflight) { outgoing.setHeader('Retry-After', '1'); return reject(503, 'verifier busy'); }
    active++;
    try {
      const body = await readBody(incoming, config.bodyTimeoutMs);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const response = await handler(new Request(origin + incoming.url, {
        method: incoming.method, headers, body: body.length ? new Uint8Array(body) : undefined,
      }));
      if (!outgoing.destroyed) {
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      }
    } catch (error) {
      reject(error instanceof TransportError ? error.status : 503, error instanceof TransportError ? error.message : 'verifier unavailable');
    } finally { active--; if (active === 0) resolveIdle?.(); }
  });
  server.maxConnections = config.maxConnections;
  server.maxRequestsPerSocket = 100;
  server.setTimeout(config.bodyTimeoutMs + 10_000, socket => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { clearInterval(maintenance); db.close(); throw error; }
  let closing: Promise<void> | undefined;
  return { server, port: (server.address() as AddressInfo).port,
    close() {
      return closing ??= (async () => {
        stopping = true;
        clearInterval(maintenance);
        const idle = active === 0 ? Promise.resolve() : new Promise<void>(resolve => { resolveIdle = resolve; });
        const timer = setTimeout(() => server.closeAllConnections(), config.shutdownTimeoutMs);
        timer.unref();
        try {
          await Promise.all([idle, new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))]);
          db.close();
        } finally { clearTimeout(timer); }
      })();
    },
  };
}
