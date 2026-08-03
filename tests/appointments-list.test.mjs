// Command-center read model (src/lib/appointments/list.ts) — pure, DB-free. Compiled with its
// sibling recovery.ts (relative import) and proves the KPI buckets are honest, mutually exclusive
// (today vs upcoming), and reuse the lifecycle predicates. Run: node tests/appointments-list.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-apptlist-'))
execSync(
  `npx tsc src/lib/appointments/list.ts src/lib/appointments/recovery.ts --outDir ${out} ` +
    `--rootDir src/lib/appointments --module commonjs --target es2020 --moduleResolution node ` +
    `--skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { summarizeCommandCenter, apptStartMs, localDateKey } = require(join(out, 'list.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const TZ = 'America/Chicago'
// "Now" = Aug 3 2026 15:00Z (10:00 CDT). Today (CDT) = 2026-08-03.
const NOW = Date.parse('2026-08-03T15:00:00Z')
const TODAY_KEY = '2026-08-03'
const WEEK_END = NOW + 7 * 24 * 60 * 60 * 1000

// Native rows keep scheduled_at = starts_at (mig 069); default scheduled_at to starts_at so
// isOverdue (which reads scheduled_at) and the start-based buckets agree, as they do in prod.
const row = (over) => {
  const base = { id: over.id, household_id: null, opportunity_id: null, scheduled_at: null, starts_at: null, status: 'scheduled', ...over }
  if (base.scheduled_at == null) base.scheduled_at = base.starts_at
  return base
}

t('apptStartMs prefers starts_at, falls back to scheduled_at, null on bad/absent', () => {
  assert.equal(apptStartMs({ starts_at: '2026-08-03T15:00:00Z', scheduled_at: null }), NOW)
  assert.equal(apptStartMs({ starts_at: null, scheduled_at: '2026-08-03T15:00:00Z' }), NOW)
  assert.equal(apptStartMs({ starts_at: null, scheduled_at: null }), null)
  assert.equal(apptStartMs({ starts_at: 'nope', scheduled_at: null }), null)
})

t('localDateKey respects the FSA zone (a late-UTC instant is still today in CDT)', () => {
  // 2026-08-04T02:00Z is 2026-08-03 21:00 CDT → local day still Aug 3.
  assert.equal(localDateKey(Date.parse('2026-08-04T02:00:00Z'), TZ), '2026-08-03')
})

t('today vs upcoming are mutually exclusive; overdue/no-show reuse the core', () => {
  const rows = [
    row({ id: 'today-later', starts_at: '2026-08-03T20:00:00Z' }), // 15:00 CDT today
    row({ id: 'today-past', starts_at: '2026-08-03T13:00:00Z' }), // 08:00 CDT today, already past → overdue AND today
    row({ id: 'tomorrow', starts_at: '2026-08-04T16:00:00Z' }), // upcoming
    row({ id: 'next-week-edge', starts_at: '2026-08-10T14:59:00Z' }), // within 7d → upcoming
    row({ id: 'too-far', starts_at: '2026-08-20T16:00:00Z' }), // beyond window → neither
    row({ id: 'noshow', status: 'no_show', starts_at: '2026-08-01T16:00:00Z' }),
    row({ id: 'done', status: 'completed', starts_at: '2026-08-01T16:00:00Z' }),
  ]
  const ctx = {
    nowMs: NOW,
    tz: TZ,
    todayKey: TODAY_KEY,
    weekEndMs: WEEK_END,
    openFollowupApptIds: new Set(['noshow']),
    notedApptIds: new Set(),
  }
  const s = summarizeCommandCenter(rows, ctx)
  assert.equal(s.today, 2) // today-later + today-past
  assert.equal(s.upcoming, 2) // tomorrow + next-week-edge (too-far excluded)
  assert.equal(s.overdue, 1) // today-past (scheduled + past)
  assert.equal(s.noShow, 1)
  assert.equal(s.followUpsDue, 1) // the no-show has an open follow-up task
  assert.equal(s.missingNotes, 1) // 'done' is completed with no logged note
})

t('missingNotes drops to 0 once the completed appointment has a note', () => {
  const rows = [row({ id: 'done', status: 'completed', starts_at: '2026-08-01T16:00:00Z' })]
  const ctx = { nowMs: NOW, tz: TZ, todayKey: TODAY_KEY, weekEndMs: WEEK_END, openFollowupApptIds: new Set(), notedApptIds: new Set(['done']) }
  assert.equal(summarizeCommandCenter(rows, ctx).missingNotes, 0)
})

console.log(`\nAll ${passed} assertions passed.`)
