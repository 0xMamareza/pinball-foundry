import { chromium, devices } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const url = process.env.PINBALL_URL || 'http://127.0.0.1:5208/';
const out = process.env.PINBALL_EVIDENCE || 'C:/Users/mruni/AppData/Local/hermes/cache/scratch/pinball-ui-final';
await mkdir(out, { recursive: true });
const report = { url, browser: '', assets: [], findings: [], diagnostics: { errors: [], warnings: [], failedRequests: [], settlementResponses: [] } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function assets() {
  const html = await (await fetch(url)).text();
  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
  assert(paths.length >= 2, 'Production preview must serve built JS and CSS, not development source');
  return Promise.all(paths.map(async path => {
    const served = Buffer.from(await (await fetch(new URL(path, url))).arrayBuffer());
    const local = await readFile(`dist${path}`);
    assert.equal(hash(served), hash(local), `Served asset matches dist: ${path}`);
    return { path, sha256: hash(local) };
  }));
}
const browser = await chromium.launch();
report.browser = browser.version();
try {
  report.assets = await assets();
  for (const [name, options] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    ['short', { viewport: { width: 1280, height: 640 } }],
    ['mobile', { ...devices['iPhone 13'] }],
  ]) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => report.diagnostics.errors.push({ name, message: e.message }));
    page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) report.diagnostics[msg.type() === 'error' ? 'errors' : 'warnings'].push({ name, message: msg.text() }); });
    page.on('requestfailed', req => report.diagnostics.failedRequests.push({ name, url: req.url(), error: req.failure()?.errorText }));
    page.on('response', res => { if (res.url().includes('api.squeekchain.com')) report.diagnostics.settlementResponses.push({ name, status: res.status() }); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').waitFor();
    await page.waitForFunction(() => !document.querySelector('.settlement-card')?.textContent.includes('Checking the public settlement source'), undefined, { timeout: 12000 });
    const result = { name, initial: await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      return { viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, canvas: box('canvas'), machine: box('.machine-column'), controls: box('.machine-controls'), score: box('.score-panel'), reduced: matchMedia('(prefers-reduced-motion:reduce)').matches, touch: matchMedia('(pointer:coarse)').matches };
    }) };
    assert(result.initial.reduced);
    assert(result.initial.scrollWidth <= result.initial.viewport[0]);
    if (name !== 'mobile') {
      assert(result.initial.controls.y >= result.initial.score.bottom, 'Controls do not overlap score');
      assert(result.initial.controls.bottom <= result.initial.viewport[1], 'Play controls fit the viewport');
    }
    report.findings.push(result);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    if (name !== 'mobile') await page.screenshot({ path: `${out}/${name}-viewport.png` });
    if (name === 'mobile') {
      assert(result.initial.touch);
      await page.getByRole('button', { name: 'Launch ball', exact: true }).tap();
      await page.getByRole('button', { name: 'Left flipper', exact: true }).tap();
      await page.getByRole('button', { name: 'Right flipper', exact: true }).tap();
    } else {
      await page.keyboard.down('Space'); await page.waitForTimeout(400); await page.keyboard.up('Space');
      await page.keyboard.down('ArrowLeft'); await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(350); await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight');
    }
    await page.waitForFunction(() => Number(document.querySelector('output[aria-label="Score"]')?.textContent) > 0, undefined, { timeout: 10000 });
    result.score = await page.getByLabel('Score', { exact: true }).innerText();
    await page.getByRole('button', { name: 'Pause game', exact: true }).click();
    assert(await page.getByText('Tools down.').isVisible());
    await page.screenshot({ path: `${out}/${name}-paused.png`, fullPage: true });
    await page.getByRole('button', { name: 'Resume game', exact: true }).first().click();
    await page.getByRole('button', { name: 'Restart run', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('Score', { exact: true }).innerText(), '000000');
    await page.getByRole('button', { name: 'Workshop', exact: true }).click();
    await page.getByLabel('Table title', { exact: true }).fill(`Polish ${name}`);
    for (const kind of ['bumper', 'spinner', 'target']) {
      const button = page.getByRole('button', { name: `Add ${kind}`, exact: true });
      if (name === 'mobile') await button.tap(); else await button.click();
    }
    assert.equal(await page.locator('.part-list button').count(), 11);
    const last = page.locator('.part-list button').last();
    if (name === 'mobile') await last.tap(); else await last.click();
    assert.equal(await last.getAttribute('aria-pressed'), 'true');
    const before = Number(await page.getByLabel('X position', { exact: true }).inputValue());
    await page.getByRole('button', { name: 'Move part right', exact: true }).click();
    assert.equal(Number(await page.getByLabel('X position', { exact: true }).inputValue()), before + 2);
    await page.getByRole('button', { name: 'Save locally', exact: true }).click();
    assert.match(await page.locator('.notice').innerText(), /Saved locally/);
    await page.screenshot({ path: `${out}/${name}-editor.png`, fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: 'Workshop', exact: true }).click();
    await page.getByRole('button', { name: 'Load local save', exact: true }).click();
    assert.equal(await page.getByLabel('Table title', { exact: true }).inputValue(), `Polish ${name}`);
    assert.equal(await page.locator('.part-list button').count(), 11);
    await page.getByRole('button', { name: /^Create share link/ }).click();
    const link = await page.locator('.share-output textarea').inputValue();
    await page.goto(link);
    assert.equal(await page.getByLabel('Table title', { exact: true }).inputValue(), `Polish ${name}`);
    await page.getByRole('button', { name: 'Test your table', exact: true }).click();
    assert.equal(await page.locator('.cabinet-title strong').innerText(), `Polish ${name}`);
    await page.getByRole('button', { name: 'Community', exact: true }).click();
    assert(await page.getByRole('button', { name: 'Publish to Sepolia', exact: true }).isDisabled());
    assert.match(await page.locator('.undeployed').innerText(), /not deployed/);
    if (name === 'desktop') await page.screenshot({ path: `${out}/desktop-community.png`, fullPage: true });
    result.editor = '11 parts; all add controls and last part reached, selected, nudged, saved, reloaded, shared/imported and playtested';
    result.community = 'Undeployed registry remains disabled; no wallet used';
    await context.close();
  }
  assert.deepEqual(await assets(), report.assets, 'Production asset identity is unchanged after all checks');
  assert.equal(report.diagnostics.errors.length, 0, 'No runtime errors in tested flows');
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
