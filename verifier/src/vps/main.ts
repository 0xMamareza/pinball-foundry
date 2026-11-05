import { startService } from './server';
import { assertRuntime } from './configuration';

try {
  assertRuntime(process.versions.node);
  process.umask(0o077);
  const service = await startService(process.env);
  console.log(JSON.stringify({ event: 'listening', host: '127.0.0.1', port: service.port }));
  const shutdown = () => {
    void service.close().then(() => { console.log(JSON.stringify({ event: 'stopped' })); }, () => {
      console.error('verifier shutdown failed'); process.exitCode = 1;
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch {
  // Never log exception objects, environment, request bodies, paths or signing material.
  console.error('verifier startup failed');
  process.exitCode = 1;
}
