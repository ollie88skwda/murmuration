const {chromium} = require('playwright');

const BASE = 'https://flock-two.vercel.app';
const bugs = [];
const log = (msg) => console.log('[LOG]', msg);
const bug = (severity, title, details) => {
  bugs.push({severity, title, details});
  console.log(`[BUG-${severity}] ${title}: ${details}`);
};

async function createCalendar(page, name, startDate, endDate, startHour, endHour) {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  
  // Click Create calendar
  const createBtn = page.getByRole('button', { name: /create a calendar/i });
  if (await createBtn.count() === 0) {
    bug('HIGH', 'Create button not found', 'No create calendar button on homepage');
    return null;
  }
  await createBtn.click();
  await page.waitForURL('**/create**');
  log('Navigated to create page: ' + page.url());
  
  // Screenshot the create page
  await page.screenshot({path: '/tmp/flock_create.png'});
  
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  log('Create page content: ' + pageText);
  
  return page.url();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  log('=== TEST 1: Homepage Load ===');
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  
  // Check for key elements
  const hasJoinInput = await page.locator('input[placeholder*="code" i], input[placeholder*="join" i], input[type="text"]').count();
  log(`Input fields on homepage: ${hasJoinInput}`);
  
  log('=== TEST 2: Navigate to Create ===');
  await createCalendar(page, 'Test Calendar', null, null, null, null);
  
  const createPageText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  log('Create page full text: ' + createPageText);
  
  // Check what form fields exist
  const inputs = await page.locator('input, select, [contenteditable]').all();
  for (const inp of inputs) {
    const ph = await inp.getAttribute('placeholder').catch(() => null);
    const type = await inp.getAttribute('type').catch(() => null);
    const name = await inp.getAttribute('name').catch(() => null);
    log(`Input: type=${type}, name=${name}, placeholder=${ph}`);
  }
  
  await browser.close();
  
  console.log('\n=== BUGS FOUND ===');
  bugs.forEach((b, i) => console.log(`${i+1}. [${b.severity}] ${b.title}: ${b.details}`));
})().catch(e => console.error('FATAL:', e));
