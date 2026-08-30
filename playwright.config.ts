import { defineConfig, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Playwright config for the workshop E2E suite (Batch 8, Phase 5 scope).
//
// NOTHING SENDS. Two independent guarantees:
//   1. `COMMS_CAPTURE_TRANSPORT` routes both provider calls (Resend, Twilio) to a
//      capture file — see src/lib/comms/capture-transport.ts. A capture-write failure
//      fails the send rather than falling through to a provider.
//   2. `SMS_A2P_APPROVED` is left unset, so the A2P backstop refuses SMS anyway.
// Guarantee 1 is asserted IN THE SERVER PROCESS over HTTP (tests/e2e/no-live-sends.spec.ts
// reads /api/dev/comms-capture). Asserting the runner's own env would prove nothing about
// the process that actually sends. tests/e2e-guard-falsifiable.test.mjs proves that guard
// FAILS when a server reports capture off.
//
// Browser: the container's pre-installed chromium. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
// is set in the environment; never run `playwright install` here.
//
// Data-dependent journeys (register → confirm, duplicate, cancel, reschedule notice,
// check-in) require a reachable Supabase. They are declared in
// tests/e2e/workshop-journeys.spec.ts and SKIP with a printed reason when
// FSOS_E2E_SUPABASE is not set, so an unconfigured run can never read as coverage.
const PORT = Number(process.env.FSOS_E2E_PORT ?? 3737)

// PER-RUN capture file. A shared fixed path lets one run read a previous run's file as
// its own evidence (and lets two runs interleave lines); a run-scoped name cannot.
// The guard compares the server's reported target against THIS value, so the variable is
// also exported to the runner — but the server's own report is what the assertion reads.
const CAPTURE_FILE =
  process.env.COMMS_CAPTURE_TRANSPORT ??
  join(tmpdir(), 'fsos-e2e-captures', `run-${process.pid}-${Date.now()}.jsonl`)
try {
  mkdirSync(join(tmpdir(), 'fsos-e2e-captures'), { recursive: true })
} catch {
  /* best-effort; the guard fails loudly if the server cannot write here */
}
// The config module is evaluated once in the runner process and again in each forked
// worker. Pin the generated name into the environment on the FIRST load so the worker
// (forked after this line runs) inherits it and resolves to the same file — otherwise
// each load invents a new name and the guard's target check fails on its own config.
process.env.COMMS_CAPTURE_TRANSPORT = CAPTURE_FILE
process.env.FSOS_E2E_EXPECTED_CAPTURE = CAPTURE_FILE

// Escape hatch for the falsifiability harness: when PW_BASE_URL is set the suite runs
// against an already-running server (a stub, in that harness) and starts none of its own.
const EXTERNAL_BASE = process.env.PW_BASE_URL
const baseURL = EXTERNAL_BASE ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
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
  ...(EXTERNAL_BASE
    ? {}
    : {
        webServer: {
          // `next dev`, NOT `next start`, and this is load-bearing.
          //
          // Next inlines `process.env.NODE_ENV` at BUILD time. In a production build the
          // minifier constant-folds capture-transport.ts's production refusal and the
          // whole function collapses to `return null` — verified in the emitted bundle:
          //   function e(){return process.env.COMMS_CAPTURE_TRANSPORT,null}
          // That is the safety property working exactly as designed: a deployed build has
          // no capture path at all. But it also means a suite driven by `next start` runs
          // with captured transport DEAD, which is how the Batch 8 run reported itself
          // safe while the mechanism it named was inert. A dev build keeps the branch.
          command: `npx next dev -p ${PORT}`,
          url: `http://127.0.0.1:${PORT}/workshops`,
          // FALSE, deliberately. With reuse on, a server already listening on this port
          // — started by hand, by a previous run, or with no capture env at all — is
          // adopted silently and the suite's safety premise becomes unverifiable.
          // Playwright now fails the run instead of adopting a stranger's process.
          reuseExistingServer: false,
          timeout: 180_000,
          env: {
            NODE_ENV: 'development',
            COMMS_CAPTURE_TRANSPORT: CAPTURE_FILE,
            NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
            // Point the data layer at an unreachable address so the funnel's
            // degraded-state test EXERCISES a real load failure instead of asserting
            // against whatever happens to render. Only the URL is set — the anon key
            // stays unset, so middleware's auth path stays skipped. In a live-data run
            // (FSOS_E2E_SUPABASE=1) the real configuration is left alone and that test
            // skips itself.
            ...(process.env.FSOS_E2E_SUPABASE === '1'
              ? {}
              : { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_URL: 'http://127.0.0.1:1' }),
          },
        },
      }),
})
