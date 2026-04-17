// End-to-end diagnostic against real Next.js dev server + local Supabase mock.
import { chromium } from 'playwright'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true })
// Fresh, isolated context — no leftover localStorage from prior runs.
const ctx = await browser.newContext()
const page = await ctx.newPage()

const consoleLogs = []
const pageErrors = []
const failedRequests = []

page.on('console', (m) => consoleLogs.push({ type: m.type(), text: m.text() }))
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('requestfailed', (r) => {
  const url = r.url()
  // Ignore expected failures: next hmr and our mock's missing realtime ws.
  if (url.includes('_next') || url.includes('fonts') || url.startsWith('ws:')) return
  failedRequests.push(`${r.method()} ${url} — ${r.failure()?.errorText}`)
})

const results = []
async function step(label, fn) {
  const idx = pageErrors.length
  const jdx = consoleLogs.length
  const fdx = failedRequests.length
  try {
    await fn()
    const errs = [
      ...pageErrors.slice(idx),
      ...consoleLogs.slice(jdx)
        .filter((l) => l.type === 'error')
        // ignore expected ws failure to our mock
        .filter((l) => !l.text.includes('WebSocket'))
        .map((l) => `console.error: ${l.text}`),
      ...failedRequests.slice(fdx).map((f) => `fetch failed: ${f}`),
    ]
    results.push({ label, status: errs.length ? 'WARN' : 'OK', errors: errs })
  } catch (e) {
    results.push({ label, status: 'FAIL', errors: [e.message.split('\n')[0]] })
  }
}

const BASE = 'http://localhost:3000'
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

let createdCode = null

// ── Reset mock db so runs are deterministic ────────────────────────────────
await fetch('http://localhost:54321/rest/v1/calendars?id=neq.never', { method: 'DELETE' }).catch(() => {})
await fetch('http://localhost:54321/rest/v1/participants?id=neq.never', { method: 'DELETE' }).catch(() => {})
await fetch('http://localhost:54321/rest/v1/blocks?id=neq.never', { method: 'DELETE' }).catch(() => {})

await step('Load home /', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
})

await step('Click "Create a calendar" hero button', async () => {
  await page.locator('a[href="/create"] button', { hasText: 'Create a calendar' }).click()
  await page.waitForURL('**/create', { timeout: 5000 })
})

await step('Create form: fill & submit -> /share/:code', async () => {
  await page.fill('#cal-name', 'E2E Calendar')
  const today = new Date()
  await page.fill('#start-date', fmt(today))
  await page.fill('#end-date', fmt(new Date(today.getTime() + 7 * 86400000)))
  await page.click('button[type="submit"]:has-text("Create Calendar")')
  await page.waitForURL('**/share/**', { timeout: 10000 })
  createdCode = page.url().split('/share/')[1]
  if (!createdCode || createdCode === 'undefined') throw new Error(`bad code: ${createdCode}`)
  console.log(`  Created code: ${createdCode}`)
})

await step('Share page renders h1 with calendar name', async () => {
  await page.waitForLoadState('networkidle')
  const title = await page.locator('h1').first().textContent()
  if (!title?.includes('E2E Calendar')) throw new Error(`unexpected h1: ${title}`)
  // Give registerHost time to run before capturing its console errors.
  await sleep(500)
})

await step('Share: click "Open my calendar" -> /calendar/:code', async () => {
  await page.click('button:has-text("Open my calendar")')
  await page.waitForURL(`**/calendar/${createdCode}`, { timeout: 5000 })
  await page.waitForLoadState('networkidle')
  const notFound = await page.locator('h2:has-text("could not be found")').count()
  if (notFound) throw new Error('calendar page shows not-found')
})

await step('Calendar: header code badge shows the code', async () => {
  const badge = page.locator(`button[title="Click to copy code"]:has-text("${createdCode}")`).first()
  await badge.waitFor({ state: 'visible', timeout: 5000 })
})

await step('Calendar: view tabs clickable (Month/Week/Day/All)', async () => {
  for (const label of ['Mo', 'Wk', 'Day', 'All']) {
    const btn = page.locator('button', { hasText: new RegExp(`^${label}$`) }).first()
    if ((await btn.count()) === 0) throw new Error(`tab "${label}" missing`)
    await btn.click({ trial: true })
  }
})

// ── Fresh browser context simulates a second participant joining ───────────
const ctx2 = await browser.newContext()
const page2 = await ctx2.newPage()
page2.on('console', (m) => consoleLogs.push({ type: m.type(), text: `[p2] ${m.text()}` }))
page2.on('pageerror', (e) => pageErrors.push(`[p2] ${e.message}`))

await step('Home (fresh user) -> enter code -> Join page loads', async () => {
  await page2.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page2.fill('input[placeholder="ENTER CODE"]', createdCode)
  await page2.click('form button[type="submit"]:has-text("Join")')
  await page2.waitForURL(`**/join/${createdCode}`, { timeout: 5000 })
  // Name input must be visible (JoinClient only shows after checkingStorage)
  await page2.locator('#participant-name').waitFor({ state: 'visible', timeout: 3000 })
})

await step('Join: enter name and submit -> navigate to /calendar/:code', async () => {
  await page2.fill('#participant-name', 'Alice')
  await page2.click('button[type="submit"]')
  await page2.waitForURL(`**/calendar/${createdCode}`, { timeout: 5000 })
})

await step('Create: infinite toggle flow', async () => {
  await page.goto(BASE + '/create', { waitUntil: 'networkidle' })
  await page.fill('#cal-name', 'Infinite Cal')
  await page.fill('#start-date', fmt(new Date()))
  await page.click('button:has-text("No end date")')
  // End date input should now be hidden
  const endVisible = await page.locator('#end-date').count()
  if (endVisible !== 0) throw new Error('end-date input should hide when infinite')
  await page.click('button[type="submit"]:has-text("Create Calendar")')
  await page.waitForURL('**/share/**', { timeout: 10000 })
})

await page.close()
await page2.close()
await browser.close()

console.log('\n════ RESULTS ════')
let ok = 0
for (const r of results) {
  const icon = r.status === 'OK' ? '✓' : r.status === 'WARN' ? '⚠' : '✗'
  console.log(`${icon} [${r.status}] ${r.label}`)
  for (const e of r.errors) console.log(`    ${e}`)
  if (r.status === 'OK') ok++
}
console.log(`\n${ok}/${results.length} passed`)

console.log('\n════ ALL CONSOLE ERRORS ════')
for (const l of consoleLogs.filter((l) => l.type === 'error')) console.log(`  ${l.text}`)
console.log('\n════ PAGE ERRORS ════')
for (const e of pageErrors) console.log(`  ${e}`)
