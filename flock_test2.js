const {chromium} = require('playwright');

const BASE = 'https://flock-two.vercel.app';
const bugs = [];
const log = (msg) => console.log('[LOG]', msg);
const bug = (severity, title, details) => {
  bugs.push({severity, title, details});
  console.log(`\n[BUG-${severity}] ${title}\n  Details: ${details}\n`);
};

// Helper to get today + N days as YYYY-MM-DD
function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

async function fillCreateForm(page, { name, startDate, endDate, startHour, endHour }) {
  // Fill name
  const nameInput = page.locator('input[type="text"]').first();
  await nameInput.clear();
  await nameInput.fill(name);
  
  // Fill start date
  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(startDate);
  await dateInputs.nth(1).fill(endDate);
  
  // Hour inputs - find the contenteditable or number inputs
  if (startHour || endHour) {
    // Try to set hours via the UI controls
    const hourEls = await page.locator('input[type="number"], [role="spinbutton"]').all();
    log(`Hour inputs found: ${hourEls.length}`);
  }
}

async function createCalendar(browser, opts) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/create`);
  await page.waitForLoadState('networkidle');
  await fillCreateForm(page, opts);
  
  // Click create
  await page.getByRole('button', { name: /create calendar/i }).click();
  await page.waitForURL('**/share**', { timeout: 10000 });
  
  const shareCode = await page.locator('[data-code], code, .code, [class*="code"]').first().textContent().catch(() => null);
  const pageText = await page.evaluate(() => document.body.innerText);
  log('Share page text: ' + pageText.substring(0, 500));
  
  // Extract 6-letter code from text
  const match = pageText.match(/\b([A-Z]{6})\b/);
  const code = match ? match[1] : null;
  log(`Calendar code extracted: ${code}`);
  
  return { page, code, url: page.url() };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  // =============================================
  // TEST 1: Basic flow - create calendar
  // =============================================
  log('\n=== TEST 1: Basic Calendar Creation ===');
  try {
    const { page, code } = await createCalendar(browser, {
      name: 'Test Calendar',
      startDate: dateStr(1),
      endDate: dateStr(7),
    });
    
    if (!code) {
      bug('HIGH', 'No share code visible', 'After creating calendar, 6-letter code not found on share page');
    } else {
      log(`Code found: ${code}`);
    }
    
    await page.screenshot({path: '/tmp/flock_share.png'});
    await page.close();
  } catch(e) {
    bug('CRITICAL', 'Basic creation flow failed', e.message);
  }
  
  // =============================================
  // TEST 2: Edge case - very long name
  // =============================================
  log('\n=== TEST 2: Very Long Calendar Name ===');
  try {
    const longName = 'A'.repeat(200);
    const { page, code } = await createCalendar(browser, {
      name: longName,
      startDate: dateStr(1),
      endDate: dateStr(7),
    });
    const shareText = await page.evaluate(() => document.body.innerText);
    // Check if the long name appears or is truncated
    if (shareText.includes(longName)) {
      log('Long name fully displayed on share page');
    } else if (shareText.includes(longName.substring(0, 50))) {
      log('Long name truncated (may be intentional)');
    } else {
      bug('MEDIUM', 'Long name not visible on share page', `200-char name not shown; share page content: ${shareText.substring(0, 200)}`);
    }
    await page.screenshot({path: '/tmp/flock_longname.png'});
    await page.close();
  } catch(e) {
    bug('HIGH', 'Long name creation failed', e.message);
  }
  
  // =============================================
  // TEST 3: Same start and end date (single day)
  // =============================================
  log('\n=== TEST 3: Single Day Calendar ===');
  try {
    const { page, code } = await createCalendar(browser, {
      name: 'Single Day',
      startDate: dateStr(1),
      endDate: dateStr(1),
    });
    log(`Single day calendar code: ${code}`);
    await page.screenshot({path: '/tmp/flock_singleday.png'});
    
    // Navigate to join page
    if (code) {
      await page.goto(`${BASE}/join/${code}`);
      await page.waitForLoadState('networkidle');
      const joinText = await page.evaluate(() => document.body.innerText);
      log('Join page text: ' + joinText.substring(0, 300));
      await page.screenshot({path: '/tmp/flock_join.png'});
    }
    await page.close();
  } catch(e) {
    bug('MEDIUM', 'Single day calendar creation failed', e.message);
  }
  
  // =============================================
  // TEST 4: Wide date range (30+ days)  
  // =============================================
  log('\n=== TEST 4: Wide Date Range (35 days) ===');
  try {
    const { page, code } = await createCalendar(browser, {
      name: 'Long Range',
      startDate: dateStr(0),
      endDate: dateStr(35),
    });
    log(`Wide range calendar code: ${code}`);
    
    if (code) {
      // Join with a name and see the calendar view
      await page.goto(`${BASE}/join/${code}`);
      await page.waitForLoadState('networkidle');
      const nameInput = page.locator('input[type="text"]').first();
      if (await nameInput.count() > 0) {
        await nameInput.fill('Tester');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
      }
      const calText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      log('Calendar text after join: ' + calText);
      await page.screenshot({path: '/tmp/flock_widerange.png', fullPage: true});
    }
    await page.close();
  } catch(e) {
    bug('MEDIUM', 'Wide date range failed', e.message);
  }
  
  // =============================================
  // TEST 5: End date before start date
  // =============================================
  log('\n=== TEST 5: End Date Before Start Date ===');
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/create`);
    await page.waitForLoadState('networkidle');
    
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.fill('Invalid Range');
    
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill(dateStr(7));  // start = 7 days from now
    await dateInputs.nth(1).fill(dateStr(1));  // end = 1 day from now (before start)
    
    await page.getByRole('button', { name: /create calendar/i }).click();
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    
    if (currentUrl.includes('/share')) {
      bug('HIGH', 'End date before start date accepted', 'Calendar was created with end date before start date - no validation');
    } else {
      log('Validation correctly prevented creation with end < start');
      // Check for error message
      if (pageText.includes('error') || pageText.includes('invalid') || pageText.includes('before')) {
        log('Error message shown: ' + pageText);
      } else {
        bug('MEDIUM', 'No error message for invalid date range', 'End < start blocked but no user-visible error shown');
      }
    }
    await page.screenshot({path: '/tmp/flock_invaliddates.png'});
    await page.close();
  } catch(e) {
    bug('MEDIUM', 'Invalid date range test failed', e.message);
  }
  
  // =============================================
  // TEST 6: Empty calendar name
  // =============================================
  log('\n=== TEST 6: Empty Calendar Name ===');
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/create`);
    await page.waitForLoadState('networkidle');
    
    // Leave name empty, fill dates
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill(dateStr(1));
    await dateInputs.nth(1).fill(dateStr(7));
    
    await page.getByRole('button', { name: /create calendar/i }).click();
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    
    if (currentUrl.includes('/share')) {
      bug('MEDIUM', 'Empty calendar name accepted', 'Calendar created without a name');
    } else {
      log('Empty name validation works correctly');
    }
    await page.screenshot({path: '/tmp/flock_emptyname.png'});
    await page.close();
  } catch(e) {
    bug('MEDIUM', 'Empty name test failed', e.message);
  }

  await browser.close();
  
  console.log('\n\n=== ALL BUGS FOUND ===');
  bugs.forEach((b, i) => console.log(`${i+1}. [${b.severity}] ${b.title}: ${b.details}`));
  console.log(`\nTotal: ${bugs.length} issues`);
})().catch(e => console.error('FATAL:', e));
