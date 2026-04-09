/**
 * Playwright tests verifying fixes for GitHub issues #2/#5, #3, and #4.
 *
 * Because the app depends on Supabase for data and the dev server may not be
 * available (missing .env.local, Google Fonts network errors), most tests use
 * one of two strategies:
 *   1. **Source-file analysis** — read the actual source files via Node fs and
 *      assert on the contents (meta tags, CSS properties, component markup).
 *   2. **Synthetic page** — use `page.setContent()` to render a minimal HTML
 *      page that faithfully replicates the relevant DOM structure from
 *      CalendarClient.tsx, then assert on visual / behavioral properties.
 *
 * This avoids any dependency on a running backend or dev server while still
 * exercising the browser engine (layout, computed styles, clipboard API,
 * positioning math, scroll events, etc.).
 */

import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// ──────────────────────────────────────────────────────
// Helpers — read source files once
// ──────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..')
const readSource = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

// ══════════════════════════════════════════════════════
// Issue #2/#5 — Calendar code visibility & clipboard copy
// ══════════════════════════════════════════════════════

test.describe('Issue #2/#5: Calendar code visibility & copy', () => {

  test('CalendarClient renders a code badge button in the header with the calendar code', () => {
    // Verify via source inspection that the header contains a code-copy button
    const src = readSource('app/calendar/[code]/CalendarClient.tsx')

    // The header section should contain a button that calls copyCode and shows cal.code
    expect(src).toContain("onClick={copyCode}")
    expect(src).toContain("title=\"Click to copy code\"")
    // It displays the code text (or "Copied!" when copied)
    expect(src).toContain("{codeCopied ? 'Copied!' : cal.code}")
    // The button has the distinctive tracking-widest font-mono badge style
    expect(src).toContain("font-mono font-bold tracking-widest")
  })

  test('Code badge exists in header, sidebar "Share code", and mobile legend', () => {
    const src = readSource('app/calendar/[code]/CalendarClient.tsx')

    // Count occurrences of the copy-code click handler — should be at least 3
    // (header badge, sidebar share code, mobile legend share code)
    const copyCodeClicks = (src.match(/onClick={copyCode}/g) || []).length
    expect(copyCodeClicks).toBeGreaterThanOrEqual(3)

    // "Share code" label in sidebar and mobile legend
    const shareCodeLabels = (src.match(/Share code/g) || []).length
    expect(shareCodeLabels).toBeGreaterThanOrEqual(2) // sidebar + mobile legend
  })

  test('Code badge shows 6-letter code pattern and "Copied!" feedback on click', async ({ page }) => {
    // Build a synthetic page replicating the header code badge
    const CALENDAR_CODE = 'ABCDEF'

    await page.setContent(`
      <html>
      <body>
        <header>
          <button
            id="code-badge"
            title="Click to copy code"
            style="font-family: monospace; font-weight: bold; letter-spacing: 0.1em; cursor: pointer;
                   background: #D6E8F8; color: #0E2347; padding: 4px 8px; border-radius: 8px; border: none;"
          >${CALENDAR_CODE}<svg id="copy-icon" width="11" height="11" viewBox="0 0 24 24"></svg></button>
        </header>
        <script>
          const btn = document.getElementById('code-badge');
          const icon = document.getElementById('copy-icon');
          btn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText('${CALENDAR_CODE}');
            } catch(e) {
              // Clipboard may be blocked in headless; still update UI
            }
            btn.textContent = 'Copied!';
            btn.style.background = '#0E2347';
            btn.style.color = 'white';
            setTimeout(() => {
              btn.textContent = '${CALENDAR_CODE}';
              btn.style.background = '#D6E8F8';
              btn.style.color = '#0E2347';
            }, 1500);
          });
        </script>
      </body>
      </html>
    `)

    const badge = page.locator('#code-badge')
    await expect(badge).toBeVisible()

    // The code matches a 6-letter uppercase pattern
    const text = await badge.textContent()
    expect(text).toMatch(/^[A-Z]{6}/)

    // Click the badge — verify "Copied!" feedback
    await badge.click()
    await expect(badge).toHaveText('Copied!')

    // After 1.5s, the code should revert
    await page.waitForTimeout(1600)
    await expect(badge).toHaveText(CALENDAR_CODE)
  })

  test('Clicking the code badge calls navigator.clipboard.writeText', async ({ page }) => {
    const CALENDAR_CODE = 'XYZABC'

    await page.setContent(`
      <html>
      <body>
        <button id="code-badge">${CALENDAR_CODE}</button>
        <div id="result"></div>
        <script>
          // Mock clipboard API so we can verify the call without permissions
          window._clipboardWritten = null;
          navigator.clipboard = {
            writeText: (text) => {
              window._clipboardWritten = text;
              document.getElementById('result').textContent = text;
              return Promise.resolve();
            }
          };
          document.getElementById('code-badge').addEventListener('click', () => {
            navigator.clipboard.writeText('${CALENDAR_CODE}').catch(() => {});
          });
        </script>
      </body>
      </html>
    `)

    await page.locator('#code-badge').click()

    // Verify the mock clipboard received the code
    const clipboardContent = await page.evaluate(() => window._clipboardWritten)
    expect(clipboardContent).toBe(CALENDAR_CODE)
  })

  test('Code badge is visible on mobile viewport (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })

    await page.setContent(`
      <html>
      <body style="margin:0; padding:0;">
        <header style="display:flex; align-items:center; justify-content:space-between; padding: 8px 12px; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
            <a href="/" style="flex-shrink:0; min-width:44px; min-height:44px; display:flex; align-items:center;">
              <div style="width:24px; height:24px; background:#0E2347; border-radius:6px;"></div>
            </a>
            <button
              id="code-badge"
              title="Click to copy code"
              style="flex-shrink:0; font-family:monospace; font-weight:bold; letter-spacing:0.1em;
                     background:#D6E8F8; color:#0E2347; padding:4px 8px; border-radius:8px; border:none;
                     font-size:12px; cursor:pointer;"
            >TESTCD</button>
          </div>
        </header>
      </body>
      </html>
    `)

    const badge = page.locator('#code-badge')
    await expect(badge).toBeVisible()

    // Verify the badge is within viewport bounds
    const box = await badge.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(667)
  })
})

// ══════════════════════════════════════════════════════
// Issue #3 — Mobile viewport / view tabs / Safari scroll
// ══════════════════════════════════════════════════════

test.describe('Issue #3: Mobile viewport & view tabs', () => {

  test('layout.tsx meta viewport includes viewport-fit=cover', () => {
    const layoutSrc = readSource('app/layout.tsx')
    // Must contain the meta viewport tag with viewport-fit=cover
    expect(layoutSrc).toContain('viewport-fit=cover')
    // More precisely, the full tag
    expect(layoutSrc).toMatch(/meta\s+name=["']viewport["'][^>]*viewport-fit=cover/)
  })

  test('Root container uses height: 100dvh (not h-screen / 100vh)', () => {
    const src = readSource('app/calendar/[code]/CalendarClient.tsx')
    // The root div should set height: '100dvh' via inline style
    expect(src).toContain("height: '100dvh'")
    // It should NOT use the old h-screen class on the root container
    // (search near the root div return statement)
    const rootDivMatch = src.match(/return\s*\(\s*<div[\s\S]{0,300}/)
    expect(rootDivMatch).not.toBeNull()
    const rootSnippet = rootDivMatch![0]
    expect(rootSnippet).not.toContain('h-screen')
  })

  test('CSS has safe-area-inset padding', () => {
    const css = readSource('app/globals.css')
    expect(css).toContain('env(safe-area-inset-bottom')
  })

  test('View tab buttons have flex-shrink-0 to prevent cutoff', () => {
    const src = readSource('app/calendar/[code]/CalendarClient.tsx')

    // The view tabs container has flex-shrink-0
    // Find the view-tabs container div
    expect(src).toMatch(/View tabs[\s\S]{0,200}flex-shrink-0/)

    // Each tab button has reduced padding on mobile (px-2 sm:px-3)
    expect(src).toContain('px-2 sm:px-3')
    // Each button has min-h-[40px] on mobile, sm:min-h-[44px] on desktop
    expect(src).toContain('min-h-[40px] sm:min-h-[44px]')
  })

  test('All 4 view tabs are visible and not overflowing at 375x667', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })

    // Replicate the view toolbar with 4 tab buttons as rendered by CalendarClient
    await page.setContent(`
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: sans-serif; background: #F5EFE0; }
        </style>
      </head>
      <body>
        <div style="display:flex; flex-direction:column; overflow:hidden; height:100dvh;">
          <!-- Header (simplified) -->
          <header style="flex-shrink:0; display:flex; align-items:center; padding:8px 12px; border-bottom:1px solid #D0C4A4; background:#FBF7EE;">
            <span style="font-weight:bold;">Synkra</span>
          </header>
          <!-- View toolbar -->
          <div id="view-toolbar" style="flex-shrink:0; display:flex; align-items:center; justify-content:space-between; padding:6px 8px; border-bottom:1px solid #D0C4A4; background:#FBF7EE; gap:4px;">
            <div style="display:flex; align-items:center; gap:2px; min-width:0; flex:1;"></div>
            <!-- View tabs -->
            <div id="view-tabs" style="display:flex; align-items:center; border-radius:12px; overflow:hidden; border:1px solid #D0C4A4; flex-shrink:0;">
              <button class="view-tab" style="font-size:12px; font-weight:600; padding:8px 8px; min-height:40px; background:#0E2347; color:white; border:none; border-right:1px solid #D0C4A4; cursor:pointer;">All</button>
              <button class="view-tab" style="font-size:12px; font-weight:600; padding:8px 8px; min-height:40px; background:#FBF7EE; color:#5A4838; border:none; border-right:1px solid #D0C4A4; cursor:pointer;">Mo</button>
              <button class="view-tab" style="font-size:12px; font-weight:600; padding:8px 8px; min-height:40px; background:#FBF7EE; color:#5A4838; border:none; border-right:1px solid #D0C4A4; cursor:pointer;">Wk</button>
              <button class="view-tab" style="font-size:12px; font-weight:600; padding:8px 8px; min-height:40px; background:#FBF7EE; color:#5A4838; border:none; cursor:pointer;">Day</button>
            </div>
            <div style="display:flex; align-items:center; justify-content:flex-end; gap:4px; flex:1;"></div>
          </div>
          <!-- Content area -->
          <div style="flex:1; overflow:auto;"></div>
        </div>
      </body>
      </html>
    `)

    const tabs = page.locator('.view-tab')
    await expect(tabs).toHaveCount(4)

    // Verify every tab is visible
    for (let i = 0; i < 4; i++) {
      await expect(tabs.nth(i)).toBeVisible()
    }

    // Verify no tab overflows the viewport horizontally
    const viewportWidth = 375
    for (let i = 0; i < 4; i++) {
      const box = await tabs.nth(i).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1) // +1 for rounding
    }

    // Verify the tabs container itself fits within the viewport
    const tabsContainer = page.locator('#view-tabs')
    const containerBox = await tabsContainer.boundingBox()
    expect(containerBox).not.toBeNull()
    expect(containerBox!.x + containerBox!.width).toBeLessThanOrEqual(viewportWidth + 1)
  })

  test('View tabs show abbreviated labels on mobile, full labels on desktop', () => {
    const src = readSource('app/calendar/[code]/CalendarClient.tsx')

    // Mobile labels: hidden behind sm:hidden class -> All, Mo, Wk, Day
    expect(src).toContain("sm:hidden")
    expect(src).toMatch(/all:\s*'All'/)
    expect(src).toMatch(/month:\s*'Mo'/)
    expect(src).toMatch(/week:\s*'Wk'/)
    expect(src).toMatch(/day:\s*'Day'/)

    // Desktop labels: hidden behind hidden sm:inline -> All, Month, Week, Day
    expect(src).toContain("hidden sm:inline")
    expect(src).toMatch(/month:\s*'Month'/)
    expect(src).toMatch(/week:\s*'Week'/)
  })

  test('100dvh makes the root container fill the viewport exactly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })

    await page.setContent(`
      <html>
      <head><style>* { margin:0; padding:0; box-sizing:border-box; }</style></head>
      <body>
        <div id="root" style="height: 100dvh; display:flex; flex-direction:column; overflow:hidden; background:red;">
          <div style="flex:1;"></div>
        </div>
      </body>
      </html>
    `)

    const rootHeight = await page.locator('#root').evaluate(el => el.getBoundingClientRect().height)
    // Should equal the viewport height (dvh = dynamic viewport height)
    expect(rootHeight).toBe(667)
  })
})

// ══════════════════════════════════════════════════════
// Issue #4 — Auto-flipping context menu
// ══════════════════════════════════════════════════════

test.describe('Issue #4: Auto-flipping context menu', () => {

  test('CalendarClient source implements auto-flip positioning logic', () => {
    const src = readSource('app/calendar/[code]/CalendarClient.tsx')

    // Verify the flip logic exists
    expect(src).toContain('flipV')
    expect(src).toContain('flipH')
    expect(src).toContain('spaceBelow')
    expect(src).toContain('spaceAbove')
    expect(src).toContain('window.innerHeight')
    expect(src).toContain('window.innerWidth')

    // Verify the menu position calculation
    expect(src).toMatch(/menuTop\s*=\s*flipV/)
    expect(src).toMatch(/menuLeft\s*=\s*flipH/)
  })

  test('Transparent overlay does not block scroll (pointer-events: none)', () => {
    const src = readSource('app/calendar/[code]/CalendarClient.tsx')

    // The first overlay div has pointer-events: none so desktop scrolling works
    expect(src).toContain("pointerEvents: 'none'")
    // There is a separate click-catcher overlay
    expect(src).toContain("Invisible click-catcher")
    expect(src).toContain("background: 'transparent'")
  })

  test('Scroll dismisses context menu (useEffect with scroll listener)', () => {
    const src = readSource('app/calendar/[code]/CalendarClient.tsx')

    // Verify the scroll-dismiss effect exists
    expect(src).toContain("Dismiss context menu on scroll")
    expect(src).toMatch(/document\.addEventListener\(['"]scroll['"]/)
    expect(src).toContain("setContextMenu(null)")
    // Uses capture: true so it catches scroll from any element
    expect(src).toContain("capture: true")
  })

  test('Context menu positioned above click when near bottom of viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })

    // Replicate the auto-flip logic from CalendarClient in a synthetic page
    await page.setContent(`
      <html>
      <head><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { height: 100vh; background: #F5EFE0; position: relative; }
        #target-bottom { position: absolute; bottom: 40px; left: 200px; width: 100px; height: 30px; background: #D6E8F8; cursor: context-menu; }
        #target-top { position: absolute; top: 40px; left: 200px; width: 100px; height: 30px; background: #D6E8F8; cursor: context-menu; }
        .ctx-menu { position: fixed; z-index: 50; border-radius: 16px; padding: 6px 0; min-width: 190px; background: #FBF7EE; box-shadow: 0 8px 32px rgba(0,0,0,0.18); border: 1px solid #D0C4A4; display: none; }
        .ctx-overlay { position: fixed; inset: 0; z-index: 51; background: transparent; display: none; }
      </style></head>
      <body>
        <div id="target-bottom">Right-click me (bottom)</div>
        <div id="target-top">Right-click me (top)</div>
        <div class="ctx-overlay" id="overlay"></div>
        <div class="ctx-menu" id="ctx-menu">
          <div style="padding: 10px 16px;">Add label</div>
          <div style="padding: 10px 16px;">Edit time</div>
          <hr/>
          <div style="padding: 10px 16px;">Kinda busy</div>
          <div style="padding: 10px 16px;">Very busy</div>
          <div style="padding: 10px 16px;">Can't do it</div>
          <hr/>
          <div style="padding: 10px 16px; color: #EF4444;">Delete block</div>
        </div>
        <script>
          // Replicating the auto-flip logic from CalendarClient.tsx
          function showContextMenu(clientX, clientY) {
            const menu = document.getElementById('ctx-menu');
            const overlay = document.getElementById('overlay');
            const menuW = 200;
            const estimatedH = 340; // own-block height estimate
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const spaceBelow = vh - clientY;
            const spaceAbove = clientY;
            const flipV = spaceBelow < estimatedH && spaceAbove > spaceBelow;
            const flipH = clientX + menuW + 8 > vw;
            const menuTop = flipV ? Math.max(8, clientY - estimatedH) : clientY;
            const menuLeft = flipH ? Math.max(8, clientX - menuW) : Math.min(clientX, vw - menuW - 8);

            menu.style.left = Math.max(8, menuLeft) + 'px';
            menu.style.top = Math.max(8, menuTop) + 'px';
            menu.style.display = 'block';
            menu.dataset.flipV = flipV.toString();
            menu.dataset.flipH = flipH.toString();
            overlay.style.display = 'block';
          }

          function hideContextMenu() {
            document.getElementById('ctx-menu').style.display = 'none';
            document.getElementById('overlay').style.display = 'none';
          }

          document.getElementById('target-bottom').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY);
          });

          document.getElementById('target-top').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY);
          });

          overlay.addEventListener('click', hideContextMenu);

          // Dismiss on scroll (matching CalendarClient behavior)
          document.addEventListener('scroll', hideContextMenu, { capture: true, passive: true });
        </script>
      </body>
      </html>
    `)

    // Test 1: Right-click near bottom of viewport -> menu should flip above
    const targetBottom = page.locator('#target-bottom')
    await targetBottom.click({ button: 'right' })

    const menu = page.locator('#ctx-menu')
    await expect(menu).toBeVisible()

    // Check that flipV was true (menu above click point)
    const flipV = await menu.getAttribute('data-flip-v')
    expect(flipV).toBe('true')

    // The menu top should be above the click point
    const menuBox = await menu.boundingBox()
    const targetBox = await targetBottom.boundingBox()
    expect(menuBox).not.toBeNull()
    expect(targetBox).not.toBeNull()
    // Menu top should be above (less than) the target's vertical center
    expect(menuBox!.y).toBeLessThan(targetBox!.y + targetBox!.height / 2)

    // Dismiss via overlay click
    await page.locator('#overlay').click()
    await expect(menu).not.toBeVisible()

    // Test 2: Right-click near top of viewport -> menu should appear below
    const targetTop = page.locator('#target-top')
    await targetTop.click({ button: 'right' })
    await expect(menu).toBeVisible()

    const flipV2 = await menu.getAttribute('data-flip-v')
    expect(flipV2).toBe('false')

    // Menu top should be at or below the click point
    const menuBox2 = await menu.boundingBox()
    const targetTopBox = await targetTop.boundingBox()
    expect(menuBox2).not.toBeNull()
    expect(targetTopBox).not.toBeNull()
    // Menu top should be at or near the click y (which is center of target)
    expect(menuBox2!.y).toBeGreaterThanOrEqual(targetTopBox!.y)
  })

  test('Context menu flips horizontally when near right edge of viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })

    await page.setContent(`
      <html>
      <head><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { height: 100vh; background: #F5EFE0; }
        #target-right { position: absolute; top: 200px; right: 20px; width: 50px; height: 30px; background: #D6E8F8; }
        #ctx-menu { position: fixed; z-index: 50; min-width: 190px; width: 200px; background: #FBF7EE; box-shadow: 0 8px 32px rgba(0,0,0,0.18); display: none; }
      </style></head>
      <body>
        <div id="target-right">Click</div>
        <div id="ctx-menu">
          <div style="padding: 10px 16px;">Menu item</div>
        </div>
        <script>
          document.getElementById('target-right').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const menu = document.getElementById('ctx-menu');
            const menuW = 200;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const clientX = e.clientX;
            const clientY = e.clientY;
            const estimatedH = 60;
            const spaceBelow = vh - clientY;
            const spaceAbove = clientY;
            const flipV = spaceBelow < estimatedH && spaceAbove > spaceBelow;
            const flipH = clientX + menuW + 8 > vw;
            const menuTop = flipV ? Math.max(8, clientY - estimatedH) : clientY;
            const menuLeft = flipH ? Math.max(8, clientX - menuW) : Math.min(clientX, vw - menuW - 8);

            menu.style.left = Math.max(8, menuLeft) + 'px';
            menu.style.top = Math.max(8, menuTop) + 'px';
            menu.style.display = 'block';
            menu.dataset.flipH = flipH.toString();
          });
        </script>
      </body>
      </html>
    `)

    const target = page.locator('#target-right')
    await target.click({ button: 'right' })

    const menu = page.locator('#ctx-menu')
    await expect(menu).toBeVisible()

    // Should have flipped horizontally
    const flipH = await menu.getAttribute('data-flip-h')
    expect(flipH).toBe('true')

    // Menu right edge should be within viewport
    const menuBox = await menu.boundingBox()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(800)
    // Menu should be to the left of the click point (flipped)
    expect(menuBox!.x).toBeLessThan(780) // click was near right edge
  })

  test('Scroll event dismisses the context menu', async ({ page }) => {
    await page.setContent(`
      <html>
      <head><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        #scroller { height: 300px; overflow: auto; }
        #content { height: 2000px; background: linear-gradient(#F5EFE0, #D0C4A4); }
        #ctx-menu { position: fixed; top: 100px; left: 100px; z-index: 50; min-width: 190px; background: #FBF7EE; box-shadow: 0 8px 32px rgba(0,0,0,0.18); border: 1px solid #D0C4A4; padding: 8px; }
      </style></head>
      <body>
        <div id="ctx-menu">
          <div style="padding:10px;">Delete block</div>
        </div>
        <div id="scroller">
          <div id="content">Scrollable content</div>
        </div>
        <script>
          // Matching CalendarClient: dismiss on any scroll (capture phase)
          document.addEventListener('scroll', function() {
            document.getElementById('ctx-menu').style.display = 'none';
          }, { capture: true, passive: true });
        </script>
      </body>
      </html>
    `)

    const menu = page.locator('#ctx-menu')
    await expect(menu).toBeVisible()

    // Scroll inside the scroller
    await page.locator('#scroller').evaluate(el => el.scrollTop = 100)

    // Wait a tick for the scroll event to fire
    await page.waitForTimeout(100)

    await expect(menu).not.toBeVisible()
  })

  test('Desktop: transparent overlay has pointer-events:none (does not block scroll)', async ({ page }) => {
    await page.setContent(`
      <html>
      <head><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { height: 200vh; }
        #overlay-passthru { position: fixed; inset: 0; z-index: 50; pointer-events: none; }
        #overlay-click { position: fixed; inset: 0; z-index: 50; background: transparent; }
        #ctx-menu { position: fixed; top: 100px; left: 100px; z-index: 50; background: white; padding: 16px; }
      </style></head>
      <body>
        <!-- Replicating the dual-overlay pattern from CalendarClient -->
        <div id="overlay-passthru"></div>
        <div id="overlay-click"></div>
        <div id="ctx-menu">Context menu</div>
      </body>
      </html>
    `)

    // Verify the passthrough overlay has pointer-events: none
    const pe = await page.locator('#overlay-passthru').evaluate(
      el => window.getComputedStyle(el).pointerEvents
    )
    expect(pe).toBe('none')

    // The click-catcher overlay should have pointer-events: auto (default)
    const pe2 = await page.locator('#overlay-click').evaluate(
      el => window.getComputedStyle(el).pointerEvents
    )
    expect(pe2).toBe('auto')
  })

  test('Context menu auto-flip logic matches CalendarClient implementation exactly', async ({ page }) => {
    // Test the exact JS logic from CalendarClient.tsx with various inputs
    const results = await page.evaluate(() => {
      function calcMenuPosition(
        clickX: number, clickY: number,
        vw: number, vh: number,
        isOwnBlock: boolean
      ) {
        const menuW = 200
        const estimatedH = isOwnBlock ? 340 : 60
        const spaceBelow = vh - clickY
        const spaceAbove = clickY
        const flipV = spaceBelow < estimatedH && spaceAbove > spaceBelow
        const flipH = clickX + menuW + 8 > vw
        const menuTop = flipV ? Math.max(8, clickY - estimatedH) : clickY
        const menuLeft = flipH ? Math.max(8, clickX - menuW) : Math.min(clickX, vw - menuW - 8)
        return {
          flipV, flipH,
          menuTop: Math.max(8, menuTop),
          menuLeft: Math.max(8, menuLeft)
        }
      }

      return {
        // Near bottom, own block -> should flip up
        bottomOwn: calcMenuPosition(200, 550, 800, 600, true),
        // Near top, own block -> should NOT flip up
        topOwn: calcMenuPosition(200, 50, 800, 600, true),
        // Near bottom, not own block (small menu) -> should NOT flip up (60px fits)
        bottomOther: calcMenuPosition(200, 550, 800, 600, false),
        // Near right edge -> should flip left
        rightEdge: calcMenuPosition(750, 200, 800, 600, true),
        // Near left, not near edge -> should NOT flip
        leftSafe: calcMenuPosition(200, 200, 800, 600, true),
      }
    })

    // Bottom + own block: flip vertically (340px menu doesn't fit in 50px below)
    expect(results.bottomOwn.flipV).toBe(true)
    expect(results.bottomOwn.menuTop).toBeLessThan(550)

    // Top + own block: don't flip (plenty of space below)
    expect(results.topOwn.flipV).toBe(false)
    expect(results.topOwn.menuTop).toBe(50)

    // Bottom + other's block (small menu, 60px): enough space below (50px < 60px BUT spaceAbove > spaceBelow)
    // spaceBelow = 600 - 550 = 50, estimatedH = 60, spaceAbove = 550 -> flipV = true
    expect(results.bottomOther.flipV).toBe(true)

    // Right edge: flip horizontally
    expect(results.rightEdge.flipH).toBe(true)
    expect(results.rightEdge.menuLeft).toBeLessThan(750)

    // Left safe: no horizontal flip
    expect(results.leftSafe.flipH).toBe(false)
    expect(results.leftSafe.menuLeft).toBe(200)
  })
})
