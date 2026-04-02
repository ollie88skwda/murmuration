import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const base = 'http://localhost:3000';
const out = '/tmp/flock-screenshots';
mkdirSync(out, { recursive: true });
const exe = '/Users/Ollie/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';

async function shot(page, name) {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

const browser = await chromium.launch({ headless: true, executablePath: exe });

// Create a calendar to get a code (isolated context)
const init = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await init.newPage();
await p.goto(`${base}/create`, { waitUntil: 'networkidle' });
const dateInputs = await p.locator('input[type="date"]').all();
await p.fill('input[placeholder="Summer Trip Planning"]', 'Beach Weekend');
await dateInputs[0].fill('2026-05-10');
await dateInputs[1].fill('2026-05-14');
await p.locator('button[type="submit"]').click();
await p.waitForURL('**/share/**', { timeout: 12000 });
const code = p.url().split('/share/')[1];
console.log('code:', code);
await init.close();

// ── DESKTOP ──────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const d = await ctx.newPage();

  await d.goto(base, { waitUntil: 'networkidle' }); await shot(d, 'desktop-home');
  await d.goto(`${base}/create`, { waitUntil: 'networkidle' }); await shot(d, 'desktop-create');

  // Share page in its own context (it sets localStorage — isolate it)
  const shareCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const sd = await shareCtx.newPage();
  await sd.goto(`${base}/share/${code}`, { waitUntil: 'networkidle' });
  await shot(sd, 'desktop-share');
  await shareCtx.close();

  // Join page — ctx has no localStorage yet
  await d.goto(`${base}/join/${code}`, { waitUntil: 'networkidle' });
  await shot(d, 'desktop-join');
  await d.fill('input[placeholder="Your name"]', 'Alice');
  await d.locator('button[type="submit"]').click();
  await d.waitForURL('**/calendar/**', { timeout: 10000 });
  await d.waitForTimeout(2500);
  await shot(d, 'desktop-calendar');
  await ctx.close();
}

// ── MOBILE ───────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const m = await ctx.newPage();

  await m.goto(base, { waitUntil: 'networkidle' }); await shot(m, 'mobile-home');
  await m.goto(`${base}/create`, { waitUntil: 'networkidle' }); await shot(m, 'mobile-create');

  const shareCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const sm = await shareCtx.newPage();
  await sm.goto(`${base}/share/${code}`, { waitUntil: 'networkidle' });
  await shot(sm, 'mobile-share');
  await shareCtx.close();

  await m.goto(`${base}/join/${code}`, { waitUntil: 'networkidle' });
  await shot(m, 'mobile-join');
  await m.fill('input[placeholder="Your name"]', 'Bob');
  await m.locator('button[type="submit"]').click();
  await m.waitForURL('**/calendar/**', { timeout: 10000 });
  await m.waitForTimeout(2500);
  await shot(m, 'mobile-calendar');
  await ctx.close();
}

await browser.close();
console.log('\n✅ All screenshots saved to', out);
