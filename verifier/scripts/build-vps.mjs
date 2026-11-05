import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const v2 = process.argv.includes('--v2');
const outdir = join(root, v2 ? 'dist/vps-v2' : 'dist/vps');
mkdirSync(outdir, { recursive: true });
const result = await build({ absWorkingDir: root, entryPoints: [v2 ? 'src/vps/v2/main.ts' : 'src/vps/main.ts'], outfile: join(outdir, 'server.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24', charset: 'utf8', metafile: true,
  sourcemap: false, legalComments: 'linked', loader: { '.sql': 'text' }, logLevel: 'warning' });
const packages = [...new Set(Object.keys(result.metafile.inputs).flatMap(input => {
  const marker = 'node_modules/';
  const offset = input.lastIndexOf(marker);
  if (offset < 0) return [];
  const segments = input.slice(offset + marker.length).split('/');
  return [segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]];
}))].sort();
const notices = packages.map(name => {
  const packageRoot = join(root, 'node_modules', name);
  const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (metadata.license !== 'MIT') throw Error(`unreviewed dependency license: ${name}`);
  const license = readFileSync(join(packageRoot, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim();
  if (!license.includes('Permission is hereby granted') || !license.includes('THE SOFTWARE IS PROVIDED'))
    throw Error(`incomplete dependency license: ${name}`);
  return `${name}@${metadata.version} (MIT)\n${license}`;
}).join('\n\n---\n\n') + '\n';
writeFileSync(join(outdir, 'THIRD_PARTY_NOTICES.txt'), notices);
const bytes = readFileSync(join(outdir, 'server.mjs'));
const manifest = { format: 1, runtime: 'Node.js >=24.20.0 <25 (validated with 24.20.0)',
  entrypoint: 'server.mjs', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  notices: 'THIRD_PARTY_NOTICES.txt', packages, noticesSha256: createHash('sha256').update(notices).digest('hex') };
writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
