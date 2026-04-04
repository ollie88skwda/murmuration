const {chromium} = require('playwright');

const BASE = 'https://flock-two.vercel.app';
const bugs = [];
const log = (msg) => console.log('[LOG]', msg);
const bug = (severity, title, details) => {
  bugs.push({severity, title, details});
  console.log(`\n[BUG-${severity}] ${title}\n  Details: ${details}\n`);
};

function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

async function createAndGetCode(browser, name = 'Test') {
  const page = await browser.newPage();
  await page.goto(`${BASE}/create`);
  await page.waitForLoadState('networkidle');
  
  await page.locator('input[type="text"]').first().fill(name);
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(dateStr(1));
  await dateInputs.nth(1).fill(dateStr(7));
  
  await page.getByRole('button', { name: /create calendar/i }).click();
  await page.waitForURL('**/share**', { timeout: 10000 });
  
  const pageText = await page.evaluate(() => document.body.innerText);
  // Code is alphanumeric 6 chars - look for it
  const match = pageText.match(/\b([A-Z0-9]{6})\b/g);
  log('Code candidates: ' + JSON.stringify(match));
  
  // Look at actual DOM
  const codeEl = await page.locator('[class*="code"], [class*="Code"], code, .font-mono, [class*="share-code"], [class*="shareCode"]').all();
  log(`Code elements found: ${codeEl.length}`);
  for (const el of codeEl) {
    const txt = await el.textContent().catch(() => null);
    log(`Code element text: "${txt}"`);
  }
  
  const code = match ? match.find(m => m !== 'CODE') : null;
  log(`Using code: ${code}`);
  await page.close();
  return code;
}

async function joinCalendar(browser, code, userName) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/join/${code}`);
  await page.waitForLoadState('networkidle');
  
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  log('Join page: ' + pageText);
  
  const nameInput = page.locator('input[type="text"]').first();
  if (await nameInput.count() > 0) {
    await nameInput.fill(userName);
    // Find submit button
    const submitBtn = page.getByRole('button', { name: /join|enter|go/i });
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(2000);
    await page.waitForURL('**/calendar/**', { timeout: 10000 }).catch(() => log('Did not navigate to calendar'));
  }
  
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  log('\n=== Getting a fresh calendar code ===');
  const code = await createAndGetCode(browser, 'Drag Test Calendar');
  
  if (!code) {
    bug('CRITICAL', 'Cannot extract code', 'Code extraction from share page failed - blocking further tests');
    await browser.close();
    return;
  }
  
  // =============================================
  // TEST 7: Join flow and calendar view
  // =============================================
  log('\n=== TEST 7: Join Calendar ===');
  const calPage = await joinCalendar(browser, code, 'Alice');
  const calUrl = calPage.url();
  log('Calendar URL: ' + calUrl);
  
  await calPage.screenshot({path: '/tmp/flock_calendar.png', fullPage: true});
  
  const calText = await calPage.evaluate(() => document.body.innerText.substring(0, 1000));
  log('Calendar page text: ' + calText);
  
  if (!calUrl.includes('/calendar/')) {
    bug('HIGH', 'Join flow broken', `After joining, URL is ${calUrl} instead of /calendar/...`);
  }
  
  // =============================================
  // TEST 8: Drag interactions
  // =============================================
  log('\n=== TEST 8: Drag Interactions ===');
  
  // Find grid cells
  const cells = await calPage.locator('[class*="cell"], [class*="slot"], [class*="hour"], [class*="grid"] > div, td').all();
  log(`Grid cells found: ${cells.length}`);
  
  // Take a screenshot to understand the layout
  await calPage.screenshot({path: '/tmp/flock_calendar_detail.png'});
  
  // Try to find a draggable area
  const grid = calPage.locator('[class*="grid"], [class*="calendar"], [class*="schedule"]').first();
  if (await grid.count() > 0) {
    const bb = await grid.boundingBox();
    log(`Grid bounding box: ${JSON.stringify(bb)}`);
    
    if (bb) {
      // Try a simple drag
      try {
        await calPage.mouse.move(bb.x + 50, bb.y + 50);
        await calPage.mouse.down();
        await calPage.mouse.move(bb.x + 50, bb.y + 150, { steps: 5 });
        await calPage.mouse.up();
        await calPage.waitForTimeout(1000);
        await calPage.screenshot({path: '/tmp/flock_after_drag.png'});
        log('Drag completed');
      } catch(e) {
        bug('HIGH', 'Drag failed', e.message);
      }
    }
  }
  
  // Inspect DOM more carefully
  const html = await calPage.evaluate(() => {
    // Find time slot elements
    const allDivs = [...document.querySelectorAll('div[class]')];
    const candidates = allDivs.filter(d => {
      const cls = d.className.toLowerCase();
      return cls.includes('slot') || cls.includes('cell') || cls.includes('hour') || 
             cls.includes('time') || cls.includes('block') || cls.includes('grid');
    });
    return candidates.slice(0, 10).map(d => ({
      class: d.className,
      rect: d.getBoundingClientRect(),
      text: d.textContent.substring(0, 50)
    }));
  });
  log('Interesting DOM elements: ' + JSON.stringify(html, null, 2));
  
  // =============================================
  // TEST 9: Invalid calendar code (navigation)
  // =============================================
  log('\n=== TEST 9: Invalid Calendar Code ===');
  const invalidPage = await browser.newPage();
  await invalidPage.goto(`${BASE}/calendar/INVALID`);
  await invalidPage.waitForLoadState('networkidle');
  await invalidPage.waitForTimeout(2000);
  
  const invalidUrl = invalidPage.url();
  const invalidText = await invalidPage.evaluate(() => document.body.innerText.substring(0, 500));
  log('Invalid URL result: ' + invalidUrl);
  log('Invalid page text: ' + invalidText);
  await invalidPage.screenshot({path: '/tmp/flock_invalid.png'});
  
  if (!invalidText.includes('not found') && !invalidText.includes('error') && !invalidText.includes('invalid') && !invalidText.includes('404')) {
    bug('HIGH', 'No error for invalid calendar code', `Navigating to /calendar/INVALID shows: "${invalidText.substring(0, 200)}"`);
  }
  await invalidPage.close();
  
  // =============================================
  // TEST 10: Direct /join/INVALID
  // =============================================
  log('\n=== TEST 10: Invalid Join Code ===');
  const joinInvalidPage = await browser.newPage();
  await joinInvalidPage.goto(`${BASE}/join/XXXXXX`);
  await joinInvalidPage.waitForLoadState('networkidle');
  await joinInvalidPage.waitForTimeout(2000);
  
  const joinInvalidText = await joinInvalidPage.evaluate(() => document.body.innerText.substring(0, 500));
  log('Join invalid page: ' + joinInvalidText);
  await joinInvalidPage.screenshot({path: '/tmp/flock_join_invalid.png'});
  
  if (!joinInvalidText.includes('not found') && !joinInvalidText.includes('error') && !joinInvalidText.includes('invalid') && !joinInvalidText.includes('404')) {
    bug('MEDIUM', 'No error for invalid join code', `Page shows: "${joinInvalidText.substring(0, 200)}"`);
  }
  await joinInvalidPage.close();
  
  await calPage.close();
  await browser.close();
  
  console.log('\n\n=== BUGS FOUND ===');
  bugs.forEach((b, i) => console.log(`${i+1}. [${b.severity}] ${b.title}: ${b.details}`));
  console.log(`\nTotal: ${bugs.length} issues`);
})().catch(e => console.error('FATAL:', e));
