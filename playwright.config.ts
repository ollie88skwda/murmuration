import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL: 'http://localhost:3000',
  },
  /* Do NOT start a webServer automatically — the dev server requires
     Supabase credentials and may fail on Google Fonts network calls.
     Many tests use page.setContent() or source-file analysis and don't
     need a running server at all. */
})
