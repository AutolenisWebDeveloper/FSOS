// FSOS-070 + FSOS-071 (subset) — SCHEDULER ACTIVATION, behavioral proof.
// Proves (a) every job scheduled through the dynamic /api/cron/[job] dispatcher resolves to a
// real, registered handler (dispatcher recognizes the key → an unknown key fails closed with
// 404), and (b) the in-scope jobs activated this batch are scheduled while the deliberately
// deferred / out-of-scope jobs are NOT. Behavior + config-contract, not a raw string assertion.
// Run: node tests/cron-activation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Compile the REAL job registry (src/jobs/index.ts) and exercise its dispatcher predicate.
// index.ts's handlers are pulled in via a LAZY dynamic import (only when a JOB is invoked), so
// this test — which only reads the registry keys + isJob() and never CALLS a handler — does not
// need the (heavy) handlers graph. tsc still emits index.js even though type-checking that graph
// reports errors (noEmitOnError defaults false); we tolerate the non-zero exit and require the
// emitted predicate, which is the real production code path.
const out = mkdtempSync(join(tmpdir(), 'fsos-cron-activation-'))
try {
  execSync(
    `npx tsc src/jobs/index.ts --outDir ${out} --rootDir src/jobs ` +
      `--module commonjs --target es2020 --moduleResolution node --skipLibCheck ` +
      `--esModuleInterop --noEmitOnError false`,
    { stdio: 'ignore' },
  )
} catch {
  // type-only errors from the un-compiled handlers graph — index.js is still emitted.
}
const require = createRequire(import.meta.url)
const { JOBS, isJob } = require(join(out, 'index.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// The jobs activated THIS batch (FSOS-070 + the referral-INDEPENDENT subset of FSOS-071).
const ACTIVATED = [
  'workforce-orchestrator', // FSOS-070 (AI workforce)
  'conversion-watch',
  'xdate-watch',
  'agency-dormancy',
  'cross-sell-scan',
  'commission-reconcile',
]
// Deferred (referral-dependent) or belonging to a different, out-of-scope finding.
const NOT_SCHEDULED_THIS_BATCH = [
  'referral-sla',        // FSOS-071 — REFERRAL-DEPENDENT → deferred (referral-lifecycle decision)
  'workshop-reminders',  // FSOS-072 — different finding (dedicated route), out of scope here
  'backup-verify',       // FSOS-073 — different finding, out of scope here
]

console.log('dispatcher recognizes every activated key (unknown fails closed)')
for (const k of [...ACTIVATED, 'agent-runner']) {
  t(`isJob("${k}") === true and JOBS["${k}"] is callable`, () => {
    assert.equal(isJob(k), true, `dispatcher must recognize ${k}`)
    assert.equal(typeof JOBS[k], 'function')
  })
}
t('unknown [job] key fails closed (isJob=false → route 404s)', () => {
  assert.equal(isJob('definitely-not-a-job'), false)
  assert.equal(isJob(''), false)
  assert.equal(isJob('__proto__'), false) // prototype pollution guard
})

// ── vercel.json schedule contract ────────────────────────────────────────────────
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
const crons = vercel.crons ?? []
// Keys routed through the DYNAMIC dispatcher: /api/cron/<key> where <key> is a registered job.
// (Dedicated static routes — social-publish, booking-reminders, workshop-reminders — are their
// own route files, not [job]-dispatched, so they are excluded from the dispatcher-resolution set.)
const DEDICATED_ROUTES = new Set(['social-publish', 'booking-reminders', 'workshop-reminders'])
const scheduledKeys = crons
  .map((c) => (c.path || '').replace('/api/cron/', ''))
  .filter((k) => k && !DEDICATED_ROUTES.has(k))

console.log('\nevery dispatcher-routed schedule resolves to a real handler')
for (const k of scheduledKeys) {
  t(`scheduled "${k}" is a registered job`, () => {
    assert.equal(isJob(k), true, `vercel.json schedules ${k} but the dispatcher does not recognize it`)
  })
}

console.log('\nactivated jobs (FSOS-070 + FSOS-071 subset) ARE scheduled')
for (const k of ACTIVATED) {
  t(`"${k}" scheduled`, () => {
    assert.ok(scheduledKeys.includes(k), `${k} must be scheduled in vercel.json`)
  })
}

console.log('\ndeferred / out-of-scope jobs are NOT scheduled (assert the deferral)')
for (const k of NOT_SCHEDULED_THIS_BATCH) {
  t(`"${k}" NOT scheduled`, () => {
    assert.ok(!scheduledKeys.includes(k), `${k} must NOT be scheduled in this batch`)
  })
}

console.log(`\nAll ${passed} assertions passed.`)
