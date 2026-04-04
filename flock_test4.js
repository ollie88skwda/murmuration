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
  await dateInputs.nth(0).fill(dateStr(0));
  await dateInputs.nth(1).fill(dateStr(7));
  await page.getByRole('button', { name: /create calendar/i }).click();
  await page.waitForURL('**/share**', { timeout: 10000 });
  const pageText = await page.evaluate(() => document.body.innerText);
  const match = pageText.match(/\b([A-Z0-9]{6})\b/g);
  const code = match ? match.find(m => m !== 'CODE') : null;
  await page.close();
  return code;
}

async function joinAsUser(browser, code, userName) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/join/${code}`);
  await page.waitForLoadState('networkidle');
  const nameInput = page.locator('input[type="text"]').first();
  await nameInput.fill(userName);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.waitForURL('**/calendar/**', { timeout: 10000 }).catch(() => {});
  return page;
}

// Get the actual draggable grid cells
async function getGridInfo(page) {
  return await page.evaluate(() => {
    // Find the grid container
    const gridScroll = document.querySelector('.grid-scroll');
    if (!gridScroll) return null;
    
    // Find all the time slot cells
    const inner = gridScroll.querySelector('[class*="inner"], [class*="grid"]');
    
    // Look for actual interactive cells
    const allEls = [...document.querySelectorAll('*')].filter(el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return rect.width > 20 && rect.height > 10 && rect.height < 100 &&
             rect.width < 200 && rect.top > 100 &&
             (style.cursor === 'pointer' || el.getAttribute('data-slot') !== null ||
              el.className.includes('slot') || el.className.includes('cell'));
    });
    
    return {
      scrollerRect: gridScroll.getBoundingClientRect(),
      interactiveEls: allEls.slice(0, 5).map(el => ({
        class: el.className,
        tag: el.tagName,
        rect: el.getBoundingClientRect(),
        dataAttrs: [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`)
      }))
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  const code = await createAndGetCode(browser, 'Drag Test Calendar');
  log(`Using code: ${code}`);
  
  const page = await joinAsUser(browser, code, 'DragTester');
  log('On calendar page: ' + page.url());
  
  // Dismiss any onboarding tooltip
  const tooltipClose = page.locator('[class*="tooltip"] button, [class*="dismiss"], [class*="close"]');
  if (await tooltipClose.count() > 0) {
    await tooltipClose.first().click();
  }
  // Press Escape to close any overlays
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  
  // Get grid info
  const gridInfo = await getGridInfo(page);
  log('Grid info: ' + JSON.stringify(gridInfo, null, 2));
  
  // Inspect DOM more deeply for the grid structure
  const domInfo = await page.evaluate(() => {
    const scroll = document.querySelector('.grid-scroll');
    if (!scroll) return 'NO GRID-SCROLL FOUND';
    const children = [...scroll.children];
    return children.map(c => ({
      class: c.className,
      tag: c.tagName,
      children: [...c.children].slice(0,3).map(cc => ({
        class: cc.className,
        tag: cc.tagName,
        html: cc.outerHTML.substring(0, 200)
      }))
    }));
  });
  log('DOM structure: ' + JSON.stringify(domInfo, null, 2));
  
  // Take a screenshot to see the current state
  await page.screenshot({path: '/tmp/flock_cal_before_drag.png'});
  
  // Find the actual grid area and try drag
  const gridRect = await page.evaluate(() => {
    const scroll = document.querySelector('.grid-scroll');
    if (!scroll) return null;
    const r = scroll.getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height};
  });
  
  log('Grid rect: ' + JSON.stringify(gridRect));
  
  if (gridRect) {
    // The grid should show time slots - the header is typically at the top
    // Try dragging from partway down (after the header row with dates)
    const startX = gridRect.x + 200; // skip the time label column (usually 60-80px)
    const startY = gridRect.y + 100; // skip date header row
    
    log(`=== TEST: Basic Drag ===`);
    try {
      await page.mouse.move(startX, startY);
      await page.waitForTimeout(100);
      await page.mouse.down();
      await page.mouse.move(startX, startY + 60, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(1000);
      
      await page.screenshot({path: '/tmp/flock_after_drag1.png'});
      
      // Check if any block was created
      const blocks = await page.evaluate(() => {
        const els = [...document.querySelectorAll('*')].filter(el => {
          const cls = el.className.toLowerCase();
          return cls.includes('block') || cls.includes('busy') || cls.includes('event');
        });
        return els.slice(0, 5).map(el => ({class: el.className, text: el.textContent.substring(0, 50)}));
      });
      log('Blocks after drag: ' + JSON.stringify(blocks));
      
    } catch(e) {
      bug('HIGH', 'Basic drag failed', e.message);
    }
    
    log(`=== TEST: Upward Drag ===`);
    try {
      const startY2 = gridRect.y + 200;
      await page.mouse.move(startX + 100, startY2);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY2 - 80, { steps: 5 }); // drag upward
      await page.mouse.up();
      await page.waitForTimeout(1000);
      await page.screenshot({path: '/tmp/flock_upward_drag.png'});
      log('Upward drag completed');
    } catch(e) {
      bug('MEDIUM', 'Upward drag threw exception', e.message);
    }
    
    log(`=== TEST: Single Slot Drag ===`);
    try {
      await page.mouse.move(startX + 200, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 200, startY + 5, { steps: 2 }); // tiny drag
      await page.mouse.up();
      await page.waitForTimeout(1000);
      await page.screenshot({path: '/tmp/flock_single_slot.png'});
      log('Single slot drag completed');
    } catch(e) {
      bug('MEDIUM', 'Single slot drag failed', e.message);
    }
    
    log(`=== TEST: Rapid Multiple Drags ===`);
    try {
      for (let i = 0; i < 5; i++) {
        const x = startX + (i * 80);
        await page.mouse.move(x, startY + 300);
        await page.mouse.down();
        await page.mouse.move(x, startY + 360, { steps: 3 });
        await page.mouse.up();
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(1000);
      await page.screenshot({path: '/tmp/flock_rapid_drags.png'});
      log('Rapid drags completed');
    } catch(e) {
      bug('MEDIUM', 'Rapid drags failed', e.message);
    }
  }
  
  // =============================================
  // TEST: Right-click context menu
  // =============================================
  log('\n=== TEST: Right-Click Context Menu ===');
  await page.screenshot({path: '/tmp/flock_before_rclick.png'});
  
  // First see what's on the page now
  const currentBlocks = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(el => {
      const rect = el.getBoundingClientRect();
      const cls = el.className;
      return rect.width > 10 && rect.height > 10 && 
             (cls.includes('block') || cls.includes('busy') || cls.includes('tier'));
    });
    return els.slice(0, 10).map(el => ({
      class: el.className, 
      rect: el.getBoundingClientRect(),
      text: el.textContent.substring(0, 30)
    }));
  });
  log('Current blocks on page: ' + JSON.stringify(currentBlocks, null, 2));
  
  if (gridRect) {
    // Right click in the grid area where we dragged
    await page.mouse.click(gridRect.x + 200, gridRect.y + 130, { button: 'right' });
    await page.waitForTimeout(1000);
    
    const contextMenu = await page.evaluate(() => {
      // Look for a context menu
      const menus = [...document.querySelectorAll('[role="menu"], [class*="context"], [class*="menu"], [class*="dropdown"]')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      return menus.map(m => ({class: m.className, text: m.textContent.substring(0, 100)}));
    });
    log('Context menus found: ' + JSON.stringify(contextMenu));
    await page.screenshot({path: '/tmp/flock_rclick_menu.png'});
    
    if (contextMenu.length === 0) {
      bug('MEDIUM', 'No context menu appeared on right-click', 'Right-clicking on an area showed no context menu');
    }
  }
  
  // =============================================
  // TEST: Home page join code input
  // =============================================
  log('\n=== TEST: Home Page Join Code ===');
  const homePage = await browser.newPage();
  await homePage.goto(BASE);
  await homePage.waitForLoadState('networkidle');
  
  const joinInput = homePage.locator('input[type="text"]').first();
  await joinInput.fill(code);
  await homePage.keyboard.press('Enter');
  await homePage.waitForTimeout(2000);
  
  const afterJoinUrl = homePage.url();
  log('After entering code on home: ' + afterJoinUrl);
  
  if (!afterJoinUrl.includes('/join/')) {
    bug('HIGH', 'Home page join code doesnt navigate', `Entering code on home and pressing Enter stays at: ${afterJoinUrl}`);
  }
  
  // Check if there's a button to click
  await homePage.goto(BASE);
  await homePage.waitForLoadState('networkidle');
  await joinInput.fill(code);
  const joinBtn = homePage.getByRole('button', { name: /join/i });
  log('Join button count: ' + await joinBtn.count());
  if (await joinBtn.count() > 0) {
    await joinBtn.click();
    await homePage.waitForTimeout(2000);
    log('After join button click: ' + homePage.url());
  }
  
  await homePage.close();
  
  // =============================================
  // TEST: Back button behavior
  // =============================================
  log('\n=== TEST: Back Button ===');
  const backPage = await browser.newPage();
  await backPage.goto(`${BASE}/join/${code}`);
  await backPage.waitForLoadState('networkidle');
  
  const nameInput = backPage.locator('input[type="text"]').first();
  await nameInput.fill('BackTester');
  await backPage.keyboard.press('Enter');
  await backPage.waitForURL('**/calendar/**', { timeout: 10000 }).catch(() => {});
  
  log('On calendar: ' + backPage.url());
  await backPage.goBack();
  await backPage.waitForTimeout(2000);
  log('After back: ' + backPage.url());
  
  const backText = await backPage.evaluate(() => document.body.innerText.substring(0, 300));
  log('Back page content: ' + backText);
  
  // Going back from calendar - what happens?
  if (backPage.url().includes('/calendar/')) {
    bug('LOW', 'Back button stays on calendar', 'Back button from calendar does not navigate away');
  }
  
  await backPage.close();
  await page.close();
  await browser.close();
  
  console.log('\n\n=== BUGS FOUND ===');
  bugs.forEach((b, i) => console.log(`${i+1}. [${b.severity}] ${b.title}: ${b.details}`));
  console.log(`\nTotal: ${bugs.length} issues`);
})().catch(e => console.error('FATAL:', e));
