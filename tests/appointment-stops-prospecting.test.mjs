// Follow-up R2: a booking by ANY linked contact or household member stops prospecting. Native public
// bookings never set appointments.household_id (book.ts) — the appointment is linked through
// contact_id — so every check keyed on household_id alone missed them. Cross-Sell eligibility, the
// Win-Back eligibility input (whose view keys on household_id) and the workforce check now use the
// shared upcomingAppointmentState read that Life uses, at enrollment and at the per-touch recheck.
// Run: node tests/appointment-stops-prospecting.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

let passed = 0
const at = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const NOW = new Date().toISOString()
const FUTURE = new Date(Date.now() + 3 * 86400_000).toISOString()

const booked = await bundle('src/lib/booking/appointment-booked.ts')
const xsell = await bundle('src/lib/cross-sell-life/data.ts')
const winback = await bundle('src/lib/pipeline-winback/data.ts')

function seedHousehold(db, { link }) {
  db.seed('households', [{ id: 'h1' }])
  db.seed('household_members', [{ id: 'm1', household_id: 'h1', full_name: 'Pat Example', email: 'pat@example.com', phone: '+12145550147' }])
  // The public booking's contact: linked to the household (link='contact') or only matching the
  // member's address (link='member').
  db.seed('contacts', [{ id: 'c1', household_id: link === 'contact' ? 'h1' : null, email: 'pat@example.com', email_lc: 'pat@example.com', phone: '+12145550147', phone_digits: '2145550147', deleted_at: null }])
  db.seed('appointments', [{ id: 'a1', contact_id: 'c1', household_id: null, status: 'scheduled', starts_at: FUTURE, scheduled_at: FUTURE, booked_via: 'native' }])
}

console.log('A native booking (no appointments.household_id) stops prospecting')
for (const link of ['contact', 'member']) {
  await at(`shared read: a booking by a ${link}-linked contact counts`, async () => {
    const db = memDb(); installDb(db); seedHousehold(db, { link })
    assert.equal(await booked.upcomingAppointmentState('h1', NOW), 'yes')
  })
  await at(`Cross-Sell eligibility sees the ${link}-linked booking`, async () => {
    const db = memDb(); installDb(db); seedHousehold(db, { link })
    const input = await xsell.loadEligibilityInput({ id: 'x1', reenroll_cooldown_days: 90 }, 'h1', 'm1', NOW)
    assert.notEqual(input.hasLifeAppointment, false, 'Cross-Sell missed the booking')
  })
  await at(`Win-Back eligibility sees the ${link}-linked booking even when the view says none`, async () => {
    const db = memDb(); installDb(db); seedHousehold(db, { link })
    db.seed('v_pipeline_winback_due', [{ opportunity_id: 'o1', household_id: 'h1', contact_id: 'c1', stage: 'quoted', is_security: false, stale_days: 60, do_not_contact: false, has_active_advisor_opportunity: false, has_upcoming_appointment: false }])
    const { input } = await winback.loadWinbackEligibilityInput({ id: 'w1', stale_min_days: 30 }, 'o1')
    assert.notEqual(input.hasUpcomingAppointment, false, 'Win-Back missed the booking')
  })
}
await at('a read error holds (never reads as "no appointment")', async () => {
  const db = memDb({ failOn: (st) => st.table === 'appointments' }); installDb(db); seedHousehold(db, { link: 'contact' })
  assert.equal(await booked.upcomingAppointmentState('h1', NOW), 'unknown')
  const input = await xsell.loadEligibilityInput({ id: 'x1', reenroll_cooldown_days: 90 }, 'h1', 'm1', NOW)
  assert.notEqual(input.hasLifeAppointment, false)
})
await at('the workforce uses the shared read, not a household_id-only query', async () => {
  const src = readFileSync('src/lib/ai/workforce.ts', 'utf8')
  assert.match(src, /upcomingAppointmentState/)
  assert.doesNotMatch(src, /from\('appointments'\)[\s\S]{0,200}\.eq\('household_id'/)
})
await at('every matching contact is checked: the booking on the 60th of 60 contacts still counts (CodeRabbit review of R2)', async () => {
  const db = memDb(); installDb(db)
  db.seed('households', [{ id: 'h1' }])
  db.seed('household_members', [{ id: 'm1', household_id: 'h1', email: 'pat@example.com', phone: '+12145550147' }])
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `c${String(i).padStart(3, '0')}`, household_id: null, email_lc: 'pat@example.com', phone_digits: null, deleted_at: null }))
  db.seed('contacts', many)
  db.seed('appointments', [{ id: 'a1', contact_id: 'c059', household_id: null, status: 'scheduled', starts_at: FUTURE, scheduled_at: FUTURE }])
  assert.equal(await booked.upcomingAppointmentState('h1', NOW), 'yes')
  const hh = Array.from({ length: 60 }, (_, i) => ({ id: `d${String(i).padStart(3, '0')}`, household_id: 'h1', email_lc: null, phone_digits: null, deleted_at: null }))
  db.seed('contacts', hh)
  db.seed('appointments', [{ id: 'a2', contact_id: 'd059', household_id: null, status: 'scheduled', starts_at: FUTURE, scheduled_at: FUTURE }])
  db.rows('appointments').splice(0, 1)
  assert.equal(await booked.upcomingAppointmentState('h1', NOW), 'yes', 'household-linked contact beyond the first 50')
})
console.log(`\nAll ${passed} assertions passed.`)
