import { defineConfig, devices } from '@playwright/test'

// Playwright config for the workshop E2E suite (Batch 8, Phase 5 scope).
//
// NOTHING SENDS. Two independent guarantees:
//   1. `COMMS_CAPTURE_TRANSPORT` routes both provider calls (Resend, Twilio) to a
//      capture file — see src/lib/comms/capture-transport.ts. A capture-write failure
//      fails the send rather than falling through to a provider.
//   2. `SMS_A2P_APPROVED` is left unset, so the A2P backstop refuses SMS anyway.
// The suite asserts guarantee 1 directly (tests/e2e/no-live-sends.spec.ts).
//
// Browser: the container's pre-installed chromium. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
// is set in the environment; never run `playwright install` here.
//
// Data-dependent journeys (register → confirm, duplicate, cancel, reschedule notice,
// check-in) require a reachable Supabase. They are declared in
// tests/e2e/workshop-journeys.spec.ts and SKIP with a printed reason when
// FSOS_E2E_SUPABASE is not set, so an unconfigured run can never read as coverage.
const PORT = Number(process.env.FSOS_E2E_PORT ?? 3737)

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      // The container runs as root; chromium refuses its sandbox there. Safe for a
      // local test browser driving only our own localhost build.
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // WS-056 / DESIGN: the funnel is mobile-first; 375px is a first-class target.
    // An explicit chromium viewport rather than a phone device descriptor — the phone
    // presets default to WebKit, which this container does not ship.
    {
      name: 'mobile-375',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/workshops`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      COMMS_CAPTURE_TRANSPORT: process.env.COMMS_CAPTURE_TRANSPORT ?? '/tmp/fsos-e2e-captured.jsonl',
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
    },
  },
})
