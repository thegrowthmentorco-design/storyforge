/* M0.1.3 — Playwright config.
 *
 * Scope: smoke specs that hit the public unauth surfaces of the SPA. The
 * full upload→extract happy path needs Clerk auth bypass plumbing in the
 * backend (a STORYFORGE_E2E_USER_ID env-gated dep override) — deferred
 * to M0.1.3.b.
 *
 * Run: `npm run e2e` (boots the dev server via webServer + runs specs).
 * In CI: same command — Playwright handles the dev server lifecycle.
 *
 * The dev server reads VITE_CLERK_PUBLISHABLE_KEY at import time so we
 * pass a placeholder (matches the build job in ci.yml). Real keys aren't
 * needed since these specs never trigger sign-in.
 */

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_e2e_placeholder_key_dGVzdA',
    },
  },
})
