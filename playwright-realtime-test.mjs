/**
 * Real-time multi-user test for flock
 * Tests that two concurrent users see each other's blocks live via Supabase Realtime.
 */

import { chromium } from 'playwright'

const BASE_URL = 'https://flock-two.vercel.app'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function fmtDate(d) {
  return d.toISOString().split('T')[0]
}

async function createCalendar(page) {
  await page.goto(`${BASE_URL}/create`)
  await page.waitForLoadState('networkidle')

  const today = new Date()
  const start = new Date(today); start.setDate(today.getDate() + 1)
  const end = new Date(today); end.setDate(today.getDate() + 7)

  await page.locator('#cal-name').fill('RT Test ' + Date.now())
  await page.locator('#start-date').fill(fmtDate(start))
  await page.locator('#end-date').fill(fmtDate(end))
  await page.locator('button', { hasText: 'Create Calendar' }).click()
  await page.waitForURL('**/share/**', { timeout: 10000 })

  const url = page.url()
  const match = url.match(/\/share\/([A-Z0-9]+)/i)
  if (!match) throw new Error('Could not extract code from: ' + url)
  return match[1]
}

async function joinCalendar(page, calCode, name) {
  await page.goto(`${BASE_URL}/join/${calCode}`)
  await page.waitForLoadState('networkidle')
  await sleep(500)

  // Fill name
  await page.locator('input[type="text"]').first().fill(name)

  // Click join button
  const btn = page.locator('button').filter({ hasText: /join|let.?s go|continue|enter/i }).first()
  await btn.click()

  // Wait for calendar page
  await page.waitForURL(`**\/calendar\/${calCode}`, { timeout: 10000 })
  await sleep(2000)
  console.log(`  [${name}] Joined and calendar loaded`)
}

async function countRealBlocks(page) {
  return await page.evaluate(() => {
    // renderBlocks() renders absolutely-positioned divs inside column cells.
    // Each block has a top/height calculated from slot indices, and a background color.
    const els = Array.from(document.querySelectorAll('[style*="position: absolute"]'))
    return els.filter(el => {
      const h = el.offsetHeight
      return h >= 28 && el.style.background && el.style.top && el.style.height
    }).length
  })
}

async function getFirstBlockColor(page) {
  return await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[style*="position: absolute"]'))
    const blocks = els.filter(el => el.offsetHeight >= 28 && el.style.background && el.style.top)
    return blocks.length > 0 ? (blocks[0].style.background || blocks[0].style.backgroundColor) : null
  })
}

async function getFirstBlockPos(page) {
  return await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[style*="position: absolute"]'))
    const blocks = els.filter(el => el.offsetHeight >= 28 && el.style.background && el.style.top)
    if (blocks.length === 0) return null
    const r = blocks[0].getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
}

async function findDraggableCell(page) {
  return await page.evaluate(() => {
    // Slot cells are rendered as stacked 32px divs inside date columns.
    // Find visible 32px-height blocks that are likely slot cells (not blocks).
    const candidates = Array.from(document.querySelectorAll('div'))
      .filter(el => {
        const rect = el.getBoundingClientRect()
        return (
          Math.abs(rect.height - 32) < 2 &&
          rect.width > 80 &&
          rect.top > 80 &&
          rect.top < 600 &&
          rect.left > 50
        )
      })
    if (candidates.length === 0) return null
    const r = candidates[0].getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 4 }
  })
}

const results = {
  blockInsert: false,
  tierUpdate: false,
  blockDelete: false,
}

async function run() {
  const browser = await chromium.launch({ headless: true })

  console.log('\n=== Flock Real-Time Multi-User Test ===\n')

  // ─── Step 1: Create calendar ─────────────────────────────────────────────
  console.log('Step 1: Creating a test calendar...')
  const ctx0 = await browser.newContext()
  const page0 = await ctx0.newPage()
  const calCode = await createCalendar(page0)
  await ctx0.close()
  console.log(`  Calendar code: ${calCode}`)
  console.log(`  URL: ${BASE_URL}/calendar/${calCode}`)

  // ─── Step 2 & 3: Two contexts join ───────────────────────────────────────
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  console.log('\nStep 2: User A (Alice) joins...')
  await joinCalendar(pageA, calCode, 'Alice')

  console.log('Step 3: User B (Bob) joins...')
  await joinCalendar(pageB, calCode, 'Bob')

  // Wait a moment for both Realtime subscriptions to be established
  await sleep(1500)

  // ─── Step 4: User A creates a block ──────────────────────────────────────
  console.log('\nStep 4: User A drags to create a block...')

  const countBefore = await countRealBlocks(pageB)
  console.log(`  Bob's block count BEFORE: ${countBefore}`)

  // Find a draggable cell
  const cell = await findDraggableCell(pageA)
  if (!cell) {
    console.log('  WARNING: Could not find draggable cell — trying fallback coordinates')
    // Fallback: the first date column starts around x=120 (after the 60px time col + margin)
    // The first slot is typically around y=150
    await pageA.mouse.move(200, 200)
    await pageA.mouse.down()
    await sleep(80)
    await pageA.mouse.move(200, 264) // 2 more slots = 64px
    await sleep(80)
    await pageA.mouse.up()
  } else {
    console.log(`  Dragging from (${cell.x.toFixed(0)}, ${cell.y.toFixed(0)}) down 64px...`)
    await pageA.mouse.move(cell.x, cell.y)
    await pageA.mouse.down()
    await sleep(80)
    await pageA.mouse.move(cell.x, cell.y + 64)
    await sleep(80)
    await pageA.mouse.up()
  }

  console.log('  Waiting 3s for Realtime propagation...')
  await sleep(3000)

  const countAfterInsert = await countRealBlocks(pageB)
  console.log(`  Bob's block count AFTER insert: ${countAfterInsert}`)
  results.blockInsert = countAfterInsert > countBefore
  console.log(`  Block INSERT propagation: ${results.blockInsert ? 'PASS ✓' : 'FAIL ✗'}`)

  // Also check Alice sees no duplicate
  const countOnAlice = await countRealBlocks(pageA)
  console.log(`  Alice's own block count (should be 1, no duplicates): ${countOnAlice}`)

  // ─── Step 5: User A changes tier ─────────────────────────────────────────
  console.log('\nStep 5: User A clicks block to change tier...')

  const colorBefore = await getFirstBlockColor(pageB)
  console.log(`  Bob's block color BEFORE tier change: ${colorBefore}`)

  const blockPos = await getFirstBlockPos(pageA)
  if (blockPos) {
    await pageA.mouse.click(blockPos.x, blockPos.y)
    await sleep(3000)

    const colorAfter = await getFirstBlockColor(pageB)
    console.log(`  Bob's block color AFTER tier change: ${colorAfter}`)
    results.tierUpdate = colorBefore !== colorAfter && colorAfter !== null
    console.log(`  Tier UPDATE propagation: ${results.tierUpdate ? 'PASS ✓' : 'FAIL ✗ (color unchanged or no block)'}`)
  } else {
    console.log('  No block found on Alice page to click')
  }

  // ─── Step 6: User A deletes block ────────────────────────────────────────
  console.log('\nStep 6: User A right-clicks to delete block...')

  const countBeforeDelete = await countRealBlocks(pageB)
  console.log(`  Bob's block count BEFORE delete: ${countBeforeDelete}`)

  const blockPosForDelete = await getFirstBlockPos(pageA)
  if (blockPosForDelete) {
    await pageA.mouse.click(blockPosForDelete.x, blockPosForDelete.y, { button: 'right' })
    await sleep(500)

    // Look for Delete option in the context menu
    const delBtn = pageA.locator('button').filter({ hasText: /^delete$/i }).first()
    const delVisible = await delBtn.isVisible().catch(() => false)

    if (delVisible) {
      await delBtn.click()
      await sleep(3000)
      const countAfterDelete = await countRealBlocks(pageB)
      console.log(`  Bob's block count AFTER delete: ${countAfterDelete}`)
      results.blockDelete = countAfterDelete < countBeforeDelete
      console.log(`  Block DELETE propagation: ${results.blockDelete ? 'PASS ✓' : 'FAIL ✗'}`)
    } else {
      // Try clicking the Delete text directly
      const anyDelBtn = pageA.locator('text=Delete').first()
      const anyVisible = await anyDelBtn.isVisible().catch(() => false)
      if (anyVisible) {
        await anyDelBtn.click()
        await sleep(3000)
        const countAfterDelete = await countRealBlocks(pageB)
        console.log(`  Bob's block count AFTER delete: ${countAfterDelete}`)
        results.blockDelete = countAfterDelete < countBeforeDelete
        console.log(`  Block DELETE propagation: ${results.blockDelete ? 'PASS ✓' : 'FAIL ✗'}`)
      } else {
        console.log('  Context menu delete button not visible — context menu may not have opened')
        // Try mobile long-press approach or keyboard delete
        await pageA.keyboard.press('Escape') // dismiss anything
        await sleep(200)

        // Just delete via supabase directly using page.evaluate as a last resort
        await pageA.evaluate(async () => {
          // This is a test-only hack to trigger deletion via the app's own delete logic
        })
        console.log('  Skipping delete test')
      }
    }
  } else {
    console.log('  No block found on Alice page to right-click')
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n========================================')
  console.log('=== Test Results ===')
  console.log('========================================')
  console.log(`Calendar:            ${BASE_URL}/calendar/${calCode}`)
  console.log(`Block INSERT (User A → User B): ${results.blockInsert ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Tier UPDATE  (User A → User B): ${results.tierUpdate  ? 'PASS ✓' : 'FAIL ✗ (may be same color or no block)'}`)
  console.log(`Block DELETE (User A → User B): ${results.blockDelete  ? 'PASS ✓' : 'FAIL ✗ (delete menu may not have opened)'}`)
  console.log('\n=== Fixes Applied ===')
  console.log('1. Stale channel cleanup before subscribe (all 3 channels: blocks, participants, calendar)')
  console.log('2. Optimistic temp-ID dedup on INSERT (removes temp_ block matching same participant/date/times)')
  console.log('3. Participants INSERT dedup (prevent duplicate participant entries)')
  console.log('========================================')

  await browser.close()

  const allPassed = results.blockInsert && results.tierUpdate && results.blockDelete
  process.exit(allPassed ? 0 : 1)
}

run().catch(err => {
  console.error('Test error:', err)
  process.exit(1)
})
