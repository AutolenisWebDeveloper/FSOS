// Workshop Ops P1 proof. Three parts, all DB-free:
//   1. Pure attendance/report/dashboard math (src/lib/workshops/attendance.ts) compiled
//      standalone with tsc — idempotent check-in, attendance/no-show rates + in-person/
//      virtual split, consult-conversion, lead-source attribution, cost-per-lead, dashboard
//      tiles, and the per-presenter/fund-family rollup.
//   2. Static migration guarantees (039) — additive only, no drop, no anon grant, the P1
//      columns present, RLS reaffirmed.
//   3. Static route/server guarantees — the securities firewall routes convert-to-lead to
//      FFS (not the automated engine), and check-in is idempotent via resolveCheckIn.
// Run: node tests/workshop-ops.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-wops-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log(`  ✓ ${name}`)
  passed++
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

// ── Part 1: pure math ──
execSync(
  `npx tsc src/lib/workshops/attendance.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { cwd: root, stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const m = require(join(out, 'attendance.js'))

console.log('\nIdempotent check-in (resolveCheckIn)')
ok('already-attended scan is a no-op (null)', m.resolveCheckIn({ status: 'attended', capture_method: 'checkin' }) === null)
ok('first scan (no row) -> attended/checkin', (() => {
  const r = m.resolveCheckIn(null)
  return r && r.status === 'attended' && r.capture_method === 'checkin'
})())
ok('registered row -> attended/checkin', (() => {
  const r = m.resolveCheckIn({ status: 'registered' })
  return r && r.status === 'attended'
})())

console.log('\nAttendance stats + in-person/virtual split (computeAttendanceStats)')
{
  const regs = [
    { reg_id: 'a', chosen_delivery: 'in_person' },
    { reg_id: 'b', chosen_delivery: 'in_person' },
    { reg_id: 'c', chosen_delivery: 'virtual' },
    { reg_id: 'd', chosen_delivery: 'virtual' },
    { reg_id: 'e', chosen_delivery: 'in_person' },
  ]
  const att = [
    { registration_id: 'a', status: 'attended' },
    { registration_id: 'b', status: 'no_show' },
    { registration_id: 'c', status: 'attended' },
    { registration_id: 'd', status: 'left_early' },
    // e has no attendance row -> counts as registered (not attended)
  ]
  const s = m.computeAttendanceStats(regs, att)
  ok('registrations = 5', s.registrations === 5)
  ok('attended = 2', s.attended === 2)
  ok('no_show = 1', s.noShow === 1)
  ok('left_early = 1', s.leftEarly === 1)
  // showed = attended(2) + left_early(1) = 3 -> 3/5
  ok('attendance rate = 3/5', near(s.attendanceRate, 0.6))
  ok('no-show rate = 1/5', near(s.noShowRate, 0.2))
  ok('in-person split: 3 reg, 1 attended -> 1/3', s.inPerson.registrations === 3 && near(s.inPerson.attendanceRate, 1 / 3))
  ok('virtual split: 2 reg, attended+left_early=2 -> 1.0', s.virtual.registrations === 2 && near(s.virtual.attendanceRate, 1))
}

console.log('\nConsult conversion (computeConsultConversion)')
{
  const regs = [
    { reg_id: 'a', referral_id: 'r1', appointment_booked: true },
    { reg_id: 'b', ghl_opportunity_id: 'o1', appointment_booked: false },
    { reg_id: 'c' },
    { reg_id: 'd' },
  ]
  const c = m.computeConsultConversion(regs)
  ok('booked = 2', c.consultsBooked === 2)
  ok('showed = 1', c.consultsShowed === 1)
  ok('bookedRate = 2/4', near(c.bookedRate, 0.5))
  ok('showRate = 1/2', near(c.showRate, 0.5))
}

console.log('\nLead-source attribution (attributeLeadSource)')
{
  const regs = [
    { reg_id: 'a', lead_source: 'agency-smith', referral_id: 'r1' },
    { reg_id: 'b', lead_source: 'agency-smith' },
    { reg_id: 'c', lead_source: 'utm-fb' },
    { reg_id: 'd', lead_source: null },
  ]
  const att = [{ registration_id: 'a', status: 'attended' }]
  const rows = m.attributeLeadSource(regs, att)
  const smith = rows.find((r) => r.source === 'agency-smith')
  ok('groups by source, sorted by registrations', rows[0].source === 'agency-smith' && rows[0].registrations === 2)
  ok('null lead_source falls back to "workshop"', rows.some((r) => r.source === 'workshop'))
  ok('attributed attendance + converted counts', smith.attended === 1 && smith.converted === 1)
}

console.log('\nCost per lead (costPerLead)')
ok('null when no spend entered', m.costPerLead(null, 10) === null)
ok('null when zero spend', m.costPerLead(0, 10) === null)
ok('null when no leads', m.costPerLead(500, 0) === null)
ok('spend/leads otherwise', m.costPerLead(500, 10) === 50)

console.log('\nDashboard tiles (computeDashboardTiles)')
{
  const now = '2026-07-20T00:00:00.000Z'
  const workshops = [
    { workshop_id: 'w1', status: 'published', scheduled_at: '2026-09-01T00:00:00Z' }, // upcoming
    { workshop_id: 'w2', status: 'completed', scheduled_at: '2026-03-01T00:00:00Z' }, // past
    { workshop_id: 'w3', status: 'cancelled', scheduled_at: '2026-12-01T00:00:00Z' }, // future but cancelled -> not upcoming
  ]
  const stats = new Map([
    ['w1', { registrations: 10, attendanceRate: 0.5, noShowRate: 0.5 }],
    ['w2', { registrations: 20, attendanceRate: 1.0, noShowRate: 0.0 }],
    ['w3', { registrations: 0, attendanceRate: 0, noShowRate: 0 }],
  ])
  const consults = new Map([
    ['w1', { consultsBooked: 2 }],
    ['w2', { consultsBooked: 3 }],
    ['w3', { consultsBooked: 0 }],
  ])
  const t = m.computeDashboardTiles(workshops, stats, consults, now)
  ok('upcoming = 1 (future, non-cancelled)', t.upcoming === 1)
  ok('totalRegistrations = 30', t.totalRegistrations === 30)
  ok('avgAttendanceRate averages only reg>0 (0.5,1.0) -> 0.75', near(t.avgAttendanceRate, 0.75))
  ok('avgNoShowRate averages (0.5,0.0) -> 0.25', near(t.avgNoShowRate, 0.25))
  ok('consultsBooked = 5', t.consultsBooked === 5)
}

console.log('\nPresenter / fund-family rollup (rollupByGroup)')
{
  const inputs = [
    {
      workshop_id: 'w1',
      groups: [{ key: 'fund:acme', label: 'Acme Funds' }],
      stats: { registrations: 10, attended: 5, leftEarly: 0 },
      consults: { consultsBooked: 5 },
    },
    {
      workshop_id: 'w2',
      groups: [{ key: 'fund:acme', label: 'Acme Funds' }],
      stats: { registrations: 10, attended: 5, leftEarly: 0 },
      consults: { consultsBooked: 1 },
    },
    {
      workshop_id: 'w3',
      groups: [{ key: 'fund:zen', label: 'Zen Capital' }],
      stats: { registrations: 10, attended: 8, leftEarly: 0 },
      consults: { consultsBooked: 9 },
    },
    {
      workshop_id: 'w4',
      groups: [], // internal / no presenter
      stats: { registrations: 4, attended: 2, leftEarly: 0 },
      consults: { consultsBooked: 0 },
    },
  ]
  const rows = m.rollupByGroup(inputs)
  const acme = rows.find((r) => r.key === 'fund:acme')
  ok('acme aggregates 2 workshops, 20 reg, 6 consults', acme.workshops === 2 && acme.registrations === 20 && acme.consultsBooked === 6)
  ok('acme conversion = 6/20', near(acme.conversionRate, 0.3))
  ok('sorted by conversion rate desc (zen 0.9 first)', rows[0].key === 'fund:zen')
  ok('empty groups collapse under internal', rows.some((r) => r.key === 'internal'))
}

console.log('\npct helper')
ok('pct rounds to whole percent', m.pct(0.246) === '25%')

// ── Part 2: migration 039 static guarantees ──
console.log('\nMigration 039 static guarantees')
const mig = readFileSync(join(root, 'supabase/migrations/039_workshop_attendance_ops.sql'), 'utf8')
ok('adds budget_spend (cost-per-lead)', /add column if not exists budget_spend/.test(mig))
ok('adds is_walk_in flag', /add column if not exists is_walk_in boolean not null default false/.test(mig))
ok('adds ghl_opportunity_id lead tracking', /add column if not exists ghl_opportunity_id/.test(mig))
ok('additive only — no drop table', !/drop\s+table/i.test(mig))
ok('additive only — no drop column', !/drop\s+column/i.test(mig))
ok('no anon RLS grant', !/grant\s+.*\bto\s+anon\b/i.test(mig))
ok('reaffirms RLS on workshop_attendance', /alter table workshop_attendance\s+enable row level security/.test(mig))

// ── Part 3: route/server firewall + idempotency guarantees ──
console.log('\nConvert-to-lead firewall + check-in idempotency (static)')
const regRoute = readFileSync(join(root, 'src/app/api/workshops/registrations/[id]/route.ts'), 'utf8')
ok('securities workshop routes convert to FFS (not automated engine)', /is_security === true/.test(regRoute) && /ffs_referred/.test(regRoute))
ok('non-securities convert pushes GHL prospect_client', /convertRegistrationToLead/.test(regRoute))
const server = readFileSync(join(root, 'src/lib/workshops/server.ts'), 'utf8')
ok('check-in uses resolveCheckIn for idempotent no-op', /resolveCheckIn/.test(server))
ok('convert helper firewalls is_security to FFS with no GHL push', /is_security === true/.test(server) && /routed: 'ffs'/.test(server))
ok('convert helper uses GHL_CUSTOM_FIELDS.lead_source = Event', /GHL_CUSTOM_FIELDS\.lead_source\]: 'Event'/.test(server))
const checkinRoute = readFileSync(join(root, 'src/app/api/workshops/[id]/check-in/route.ts'), 'utf8')
ok('check-in route supports token + walk-in', /checkInByToken/.test(checkinRoute) && /addWalkIn/.test(checkinRoute))
const attRoute = readFileSync(join(root, 'src/app/api/workshops/[id]/attendance/route.ts'), 'utf8')
ok('attendance reconcile route is staff-gated + audited', /requirePermission/.test(attRoute) && /reconcileAttendance/.test(attRoute))

console.log(`\n${passed} checks passed.\n`)
