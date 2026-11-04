import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const URL = process.env.PINBALL_URL || 'http://127.0.0.1:5199/';
const out = process.env.PINBALL_EVIDENCE || 'C:/Users/mruni/AppData/Local/hermes/cache/scratch/pinball-parent-proof';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const diagnostics = { errors: [], warnings: [], failedRequests: [], requests: [] };
function hook(page) {
  page.on('pageerror', e => diagnostics.errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') diagnostics.errors.push(msg.text()); if (msg.type() === 'warning') diagnostics.warnings.push(msg.text()); });
  page.on('requestfailed', req => diagnostics.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }));
  page.on('response', res => { if (res.url().includes('api.squeekchain.com')) diagnostics.requests.push({url:res.url(),status:res.status()}); });
}
const findings = {};
try {
  const context = await browser.newContext({ viewport: {width:1440,height:900}, reducedMotion:'reduce' });
  const page = await context.newPage(); hook(page);
  await page.addInitScript(() => {
    window.__audioProbe = {starts: 0, pitches: []};
    if (window.OscillatorNode) {
      const original = OscillatorNode.prototype.start;
      const set = AudioParam.prototype.setValueAtTime;
      AudioParam.prototype.setValueAtTime = function (value,when) {
        if(value>100)window.__audioProbe.pitches.push(value);
        return set.call(this,value,when);
      };
      OscillatorNode.prototype.start = function (...args) {
        window.__audioProbe.starts++;
        return original.apply(this,args);
      };
    }
  });
  await page.goto(URL,{waitUntil:'domcontentloaded'});
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(1200);
  assert.match(await page.title(), /Pinball Foundry/);
  findings.entry = { url:page.url(), title:await page.title(), canvas:await page.locator('canvas').evaluate(c => [c.width,c.height]), settlement:await page.locator('.settlement-card').innerText() };
  const desktopLayout=await page.evaluate(()=>{
    const box=(selector)=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    return {canvas:box('.playfield'),cabinet:box('.cabinet'),floor:box('.machine-floor'),plaque:box('.machine-plaque'),controls:box('.machine-controls'),status:box('.under-controls'),rankings:box('.leaderboard-panel'),fieldGuide:box('.field-guide')};
  });
  findings.desktopLayout=desktopLayout;
  assert(desktopLayout.canvas.width>=450,'The desktop playfield must have a substantial width');
  assert(desktopLayout.floor.y>=desktopLayout.cabinet.bottom,'Floor artwork must begin below the cabinet');
  assert(desktopLayout.plaque.x>=desktopLayout.floor.x&&desktopLayout.plaque.x+desktopLayout.plaque.width<=desktopLayout.floor.x+desktopLayout.floor.width,'Engraving must stay in the machine column');
  assert.match((await page.getByLabel('Machine details').textContent())?.replace(/\s+/g,' ')??'',/TABLE 01.*8 PARTS.*FREE PLAY/);
  assert(desktopLayout.rankings.y>=desktopLayout.status.bottom+6,'Leaderboard must not overlap controls/status');
  assert(desktopLayout.fieldGuide.y>=desktopLayout.rankings.bottom,'Field guide must follow rankings');
  await page.waitForFunction(() => !document.querySelector('.settlement-card')?.textContent?.includes('Checking the public settlement source'), {timeout:12_000});
  findings.settlementAfterLoad=await page.locator('.settlement-card').innerText();
  await page.screenshot({path:`${out}/01-desktop.png`,fullPage:true});
  if(findings.settlementAfterLoad.includes('Safe charge ready')){
    await page.getByRole('button',{name:'Restart run'}).click();
    assert.match(await page.locator('.settlement-card').innerText(),/SETTLED-WORK CHARGE/);
    findings.charge={label:await page.locator('.settlement-card').innerText(),restartApplied:true};
    await page.screenshot({path:`${out}/01b-charged.png`,fullPage:true});
  }
  await page.keyboard.down('Space'); await page.waitForTimeout(300); await page.keyboard.up('Space');
  await page.waitForTimeout(1000);
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350); await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight');
  await page.waitForFunction(() => Number(document.querySelector('output[aria-label="Score"]')?.textContent?.trim() ?? 0)>0,undefined,{timeout:8000});
  findings.play = { score:await page.locator('output[aria-label="Score"]').innerText(), status:await page.locator('.under-controls [role="status"]').innerText(), balls:await page.locator('.score-bottom').innerText() };
  assert(Number(findings.play.score)>0);
  const firstAudio = await page.evaluate(() => window.__audioProbe);
  assert(firstAudio.starts >= 3, 'Launch, flipper and scored impact must schedule real Web Audio oscillators');
  assert(new Set(firstAudio.pitches).size >= 2, 'Cues must use different pitches');
  await page.getByRole('button',{name:'Mute sound'}).click();
  await page.getByRole('button',{name:'Restart run'}).click();
  const idleMutedStarts = await page.evaluate(() => window.__audioProbe.starts);
  await page.keyboard.press('ArrowLeft');
  const mutedStarts = await page.evaluate(() => window.__audioProbe.starts);
  assert.equal(mutedStarts, idleMutedStarts, 'Muted input must not schedule a voice');
  await page.getByRole('button',{name:'Unmute sound'}).click();
  await page.keyboard.press('ArrowLeft');
  const unmutedStarts = await page.evaluate(() => window.__audioProbe.starts);
  assert(unmutedStarts > mutedStarts, 'Unmuted input must schedule a voice');
  findings.audio={starts:firstAudio.starts,pitches:firstAudio.pitches,mutedStarts,unmutedStarts};
  assert.match(findings.play.status, /Ball in play|Ready to launch|Shift complete/);
  await page.screenshot({path:`${out}/02-play.png`,fullPage:true});
  await page.getByRole('button',{name:'Pause game'}).click();
  assert(await page.getByText('Tools down.').isVisible());
  await page.screenshot({path:`${out}/03-paused.png`,fullPage:true});
  await page.getByRole('button',{name:'Resume game'}).first().click();
  await page.getByRole('button',{name:'Workshop',exact:true}).click();
  await page.getByLabel('Table title').fill('QA Works');
  await page.getByRole('button',{name:'Add bumper'}).click();
  await page.getByRole('button',{name:'Save locally'}).click();
  assert.match(await page.locator('.notice').innerText(),/Saved locally/);
  findings.editor={title:await page.getByLabel('Table title').inputValue(),parts:await page.locator('.part-list button').count()};
  await page.screenshot({path:`${out}/04-editor.png`,fullPage:true});
  await page.reload(); await page.getByRole('button',{name:'Workshop',exact:true}).click();
  assert.equal(await page.getByLabel('Table title').inputValue(),'QA Works','Saved workshop draft must restore on reload');
  assert.equal(await page.locator('.part-list button').count(),9);
  await page.getByRole('button',{name:'Load local save'}).click();
  assert.equal(await page.getByLabel('Table title').inputValue(),'QA Works');
  await page.getByRole('button',{name:'Test your table'}).click();
  assert(await page.locator('.cabinet-title').getByText('QA Works').isVisible());
  findings.reload='Local table restored and loaded into playable machine';
  await page.getByRole('button',{name:'Community',exact:true}).click();
  findings.community={disabled:await page.getByRole('button',{name:'Publish to Sepolia'}).isDisabled(), message:await page.locator('.undeployed').innerText()};
  assert(findings.community.disabled && /not deployed/i.test(findings.community.message));
  await page.screenshot({path:`${out}/05-community.png`,fullPage:true});
  await context.close();
  const mobile = await browser.newContext({...devices['iPhone 13'], reducedMotion:'reduce'});
  const mp = await mobile.newPage(); hook(mp);
  await mp.addInitScript(() => {
    window.__mobileAudioStarts=0;
    if(window.OscillatorNode){const start=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){window.__mobileAudioStarts++;return start.apply(this,args);};}
  });
  await mp.goto(URL,{waitUntil:'domcontentloaded'}); await mp.locator('canvas').waitFor();
  const sizes=await mp.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,touch:matchMedia('(pointer:coarse)').matches,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches}));
  assert(sizes.touch && sizes.reduce && sizes.scrollWidth<=sizes.width);
  assert.equal(await mp.locator('.machine-floor').evaluate(el=>getComputedStyle(el).display),'none','The desktop schematic must not lengthen mobile play');
  await mp.getByRole('button',{name:'Launch ball'}).tap();
  await mp.getByRole('button',{name:'Left flipper'}).tap();
  const mobileAudioStarts=await mp.evaluate(()=>window.__mobileAudioStarts);
  assert(mobileAudioStarts>=2,'Touch launch and flipper should schedule distinct mobile sound effects');
  findings.mobile={...sizes,status:await mp.locator('.under-controls [role="status"]').innerText(),audioStarts:mobileAudioStarts};
  await mp.screenshot({path:`${out}/06-mobile.png`,fullPage:true});
  await mobile.close();
  const short = await browser.newContext({viewport:{width:1280,height:640}});
  const sp=await short.newPage();hook(sp);await sp.goto(URL,{waitUntil:'domcontentloaded'});await sp.locator('canvas').waitFor();
  findings.short={width:await sp.evaluate(()=>innerWidth),scrollWidth:await sp.evaluate(()=>document.documentElement.scrollWidth)};
  await sp.screenshot({path:`${out}/07-short.png`,fullPage:true});
  await short.close();
  const themeContext=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const tp=await themeContext.newPage();hook(tp);
  await tp.goto(URL,{waitUntil:'domcontentloaded'});
  await tp.getByRole('button',{name:'Switch to light theme'}).waitFor();
  const colors=async()=>tp.evaluate(()=>({theme:document.documentElement.dataset.theme,background:getComputedStyle(document.documentElement).backgroundColor,meta:document.querySelector('meta[name="theme-color"]')?.getAttribute('content')}));
  const initialTheme=await colors();
  assert.deepEqual(initialTheme,{theme:'dark',background:'rgb(17, 29, 28)',meta:'#111c1b'});
  await tp.getByRole('button',{name:'Switch to light theme'}).click();
  await tp.reload();
  await tp.getByRole('button',{name:'Switch to dark theme'}).waitFor();
  const lightTheme=await colors();
  assert.deepEqual(lightTheme,{theme:'light',background:'rgb(243, 240, 231)',meta:'#f3f0e7'});
  await tp.screenshot({path:`${out}/08-light-option.png`,fullPage:true});
  await tp.getByRole('button',{name:'Community',exact:true}).click();
  assert.equal((await colors()).theme,'light');
  await tp.getByRole('button',{name:'Switch to dark theme'}).click();
  await tp.reload();
  await tp.getByRole('button',{name:'Switch to light theme'}).waitFor();
  assert.equal((await colors()).theme,'dark');
  findings.theme={initial:initialTheme,lightAfterReload:lightTheme,darkRestored:true,communityPreservesPreference:true};
  await themeContext.close();
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`,JSON.stringify({findings,diagnostics},null,2));
}
console.log(JSON.stringify({findings,diagnostics},null,2));
