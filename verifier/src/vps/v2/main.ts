import { startRankedService } from './server';
import { assertRuntime } from '../configuration';
try {
  assertRuntime(process.versions.node);
  process.umask(0o077);
  const service = await startRankedService(process.env);
  console.log(JSON.stringify({ event: 'listening', version: 2, storage: 'offchain', host: '127.0.0.1', port: service.port }));
  const shutdown = () => { void service.close().then(() => console.log(JSON.stringify({ event: 'stopped' })), () => {
    console.error('ranked shutdown failed'); process.exitCode = 1;
  }); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
} catch { console.error('ranked startup failed'); process.exitCode = 1; }
