import { expect, it } from 'vitest';
import * as configuration from '../src/vps/configuration';

it('pins the executable to Node 24.20+ within major 24, failing other runtimes closed', () => {
  const guard = (configuration as unknown as { assertRuntime?: (version: string) => void }).assertRuntime;
  expect(guard, 'runtime validation is not implemented').toBeTypeOf('function');
  expect(() => guard!('24.20.0')).not.toThrow();
  expect(() => guard!('24.20.1')).not.toThrow();
  for (const version of ['22.0.0', '24.19.9', '25.0.0', '26.7.0', '', '24.x.0']) {
    expect(() => guard!(version)).toThrow('unsupported runtime');
  }
});
