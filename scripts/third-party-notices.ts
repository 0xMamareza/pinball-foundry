import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Plugin } from 'vite';
import reviewedPackages from './third-party-licenses.json' with { type: 'json' };

type Review = { license: string; files: Record<string, string> };
const reviewed: Record<string, Review> = reviewedPackages;
const noticeName = /^(licen[cs]e|copying|notice|copyright)([.\-_]|$)/i;

function packageRoot(id: string): string {
  let dir = dirname(id.replace(/^\0/, '').split('?')[0]);
  while (dir !== dirname(dir) && dir.split(/[\\/]/).includes('node_modules')) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Cannot identify bundled third-party package: ${id}`);
}

function noticeFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return noticeFiles(root, file);
    return noticeName.test(entry.name) ? [relative(root, file).replaceAll('\\', '/')] : [];
  }).sort();
}

export function thirdPartyNotices(): Plugin {
  return {
    name: 'third-party-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      const roots = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          if (id.replaceAll('\\', '/').includes('/node_modules/')) roots.add(packageRoot(id));
        }
      }
      const sections: string[] = [];
      for (const root of roots) {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        const key = `${pkg.name}@${pkg.version}`;
        const review = reviewed[key];
        if (!review || pkg.license !== review.license) this.error(`Unreviewed third-party license: ${key}`);
        const files = noticeFiles(root);
        if (!files.length || JSON.stringify(files) !== JSON.stringify(Object.keys(review.files).sort())) {
          this.error(`Missing or unreviewed third-party notice files: ${key}`);
        }
        const texts = files.map(file => {
          const bytes = readFileSync(join(root, file));
          if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== review.files[file]) {
            this.error(`Changed or empty third-party notice: ${key}/${file}; review before release`);
          }
          return `--- ${file} ---\n${bytes.toString('utf8')}`;
        });
        sections.push(`${key}\nLicense: ${pkg.license}\n${texts.join('\n\n')}`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.txt',
        source: `Third-party software notices\n\nComplete upstream notices for packages included in this production bundle.\n\n${sections.sort().join('\n\n' + '='.repeat(72) + '\n\n')}\n`,
      });
    },
  };
}
