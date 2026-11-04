import { chromium, devices } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.PINBALL_URL || 'http://127.0.0.1:5207/';
const out = process.env.PINBALL_EVIDENCE || 'C:/Users/mruni/AppData/Local/hermes/cache/scratch/pinball-ui-polish';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const measurements = [];
try {
  for (const [name, options, minWidth] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }, 500],
    ['short', { viewport: { width: 1280, height: 640 } }, 320],
    ['compact', { viewport: { width: 1151, height: 900 } }, 500],
    ['mobile', { ...devices['iPhone 13'] }, 320],
  ]) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(url);
    await page.locator('canvas').waitFor();
    const size = await page.evaluate(() => {
      const rect = selector => {
        const { x, y, width, height, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height, bottom };
      };
      return { viewport: { width: innerWidth, height: innerHeight }, pageHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth,
        intro: rect('.intro'), canvas: rect('canvas'), machine: rect('.machine-column'), library: rect('.table-library'), score: rect('.score-panel'), guide: rect('.field-guide>.eyebrow'), status: rect('.under-controls') };
    });
    measurements.push({ name, ...size });
    await page.screenshot({ path: `${out}/${name}-layout.png`, fullPage: true });
    assert(size.canvas.width >= minWidth, `${name}: playable canvas must be >= ${minWidth}px wide, got ${size.canvas.width.toFixed(2)}px`);
    assert(size.scrollWidth <= size.viewport.width, `${name}: no horizontal page overflow`);
    if (name !== 'mobile') {
      assert(size.intro.bottom + 8 <= size.library.y, `${name}: title must not overlap the table picker`);
      assert(size.guide.y >= size.status.bottom + 8, `${name}: field guide must not overlap play status/actions`);
      assert(size.pageHeight <= (name === 'short' ? 1000 : 1100), `${name}: supporting rails must not create excessive bottom whitespace, page is ${size.pageHeight}px tall`);
      assert(size.canvas.bottom <= size.viewport.height, `${name}: entire playfield must fit vertically without scrolling during play, bottom is ${size.canvas.bottom.toFixed(2)}px`);
      assert(size.library.x <= 90, `${name}: workbench should use available width, not leave large side margins`);
      assert(size.machine.bottom >= size.score.bottom, `${name}: board is the primary surface, not a tiny column beside the HUD`);
    }
    await context.close();
  }
} finally {
  await writeFile(`${out}/layout-measurements.json`, JSON.stringify(measurements, null, 2));
  await browser.close();
}
console.log(JSON.stringify(measurements, null, 2));
