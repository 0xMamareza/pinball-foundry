// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { expect, test } from 'vitest';

test('production output distributes complete notices for every bundled runtime package', async () => {
  const outDir = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'pinball-notices-'));
  const packageRoots = new Set<string>();
  try {
    await build({
      configFile: resolve('vite.config.ts'),
      logLevel: 'error',
      build: { outDir, emptyOutDir: true },
      plugins: [{
        name: 'observe-production-packages',
        generateBundle(_options, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (chunk.type !== 'chunk') continue;
            for (const id of Object.keys(chunk.modules)) {
              const root = id.replaceAll('\\', '/').match(/(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1];
              if (root) packageRoots.add(root.replace(/^\0/, ''));
            }
          }
        },
      }],
    });
    const notices = await readFile(join(outDir, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    const bundledNames: string[] = [];
    for (const root of packageRoots) {
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      bundledNames.push(pkg.name);
      expect(notices).toContain(`${pkg.name}@${pkg.version}`);
      const files = (await readdir(root)).filter(name => /^(licen[cs]e|copying|notice|copyright)([.\-_]|$)/i.test(name));
      expect(files.length, `${pkg.name} has upstream license text`).toBeGreaterThan(0);
      for (const file of files) {
        expect(notices, `${pkg.name}/${file} must be complete, not metadata`).toContain(await readFile(join(root, file), 'utf8'));
      }
    }
    expect(bundledNames).toEqual(expect.arrayContaining(['react', 'react-dom', 'viem', 'scheduler', '@noble/curves', '@noble/hashes', 'abitype', 'ox']));
    expect(notices).not.toContain(resolve('.'));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}, 30_000);
