// "Connected is not enabled": the off / canary / on switch that gates every consumer this audit
// connected, and its first consumer — a carrier opt-out (Twilio 21610) closing the member's live
// campaign cadences (audit B-10 / D-12).
//   • The resolver fails CLOSED: missing row, unknown mode, read error → off; an unreadable or
//     unverified allow-list entry is not a canary.
//   • With the switch OFF (the seeded state) a 21610 writes the opt-out and closes NOTHING.
//   • canary acts only for a VERIFIED comms_test_recipients destination; on acts for all.
// Run: node tests/automation-switch.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'fsos-switch-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
try {
  execSync(
    `npx tsc src/lib/ops/automation-switch.ts src/lib/comms/opt-out.ts src/lib/comms/stop-fanout.ts src/lib/comms/conversations.ts ` +
      `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch { /* unresolved aliases are tolerated */ }
for (const f of ['ops/automation-switch.js', 'comms/opt-out.js', 'comms/stop-fanout.js']) {
  if (!existsSync(join(out, 'lib', f))) { console.error(`FATAL: ${f} was not emitted`); process.exit(1) }
}

const PHONE = '+15125551234'
let st
function reset(over = {}) {
  st = { mode: undefined, modeError: false, canary: false, canaryError: false, updates: [], ...over }
}
function from(table) {
  let op = 'select'
  const filters = []
  const b = {
    select: () => b, in: () => b, order: () => b, limit: () => b, ilike: () => b,
    eq: (c, v) => { filters.push(['eq', c, v]); return b },
    not: (c, o, v) => { filters.push(['not', c, o, v]); return b },
    upsert: () => b, insert: () => b,
    update: (row) => { op = 'update'; st.updates.push({ table, row }); return b },
    async maybeSingle() {
      if (table === 'automation_switches') {
        if (st.modeError) return { data: null, error: { message: 'boom' } }
        return { data: st.mode === undefined ? null : { mode: st.mode }, error: null }
      }
      return { data: null, error: null }
    },
    then(res, rej) {
      let r = { data: [], error: null }
      if (table === 'comms_test_recipients') {
        const verifiedFilter = filters.some(([op, c]) => op === 'not' && c === 'verified_at')
        r = st.canaryError ? { data: null, error: { message: 'boom' } } : { data: st.canary && verifiedFilter ? [{ id: 't1' }] : [], error: null }
      } else if (table === 'household_members' || table === 'contacts') {
        r = { data: [{ id: 'm1', household_id: 'h1', phone: PHONE }], error: null }
      } else if (op === 'update') {
        r = { data: [{ id: `${table}-row` }], error: null }
      }
      return Promise.resolve(r).then(res, rej)
    },
  }
  return b
}
const db = { from }
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request.endsWith('/supabase/client')) return { __esModule: true, getDb: () => db }
  if (request === './consent-events' || request.endsWith('/consent-events')) return { __esModule: true, recordConsentChange: async () => {} }
  return origLoad.call(this, request, ...rest)
}
const sw = require(join(out, 'lib/ops/automation-switch.js'))
const { recordCarrierOptOut } = require(join(out, 'lib/comms/opt-out.js'))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

console.log('The switch resolver fails closed')
await t('parseSwitchMode: only exact canary/on survive', () => {
  for (const [raw, want] of [['on', 'on'], ['canary', 'canary'], ['off', 'off'], ['ON', 'off'], ['true', 'off'], [null, 'off'], [undefined, 'off'], [1, 'off']]) {
    assert.equal(sw.parseSwitchMode(raw), want, String(raw))
  }
})
await t('switchPermits: off never, canary only for a canary target, on always', () => {
  assert.equal(sw.switchPermits('off', true), false)
  assert.equal(sw.switchPermits('canary', false), false)
  assert.equal(sw.switchPermits('canary', true), true)
  assert.equal(sw.switchPermits('on', false), true)
})
await t('a missing row reads as off', async () => { reset(); assert.equal(await sw.readSwitchMode('callback_engine_state'), 'off') })
await t('a read error reads as off', async () => { reset({ mode: 'on', modeError: true }); assert.equal(await sw.readSwitchMode('callback_engine_state'), 'off') })
await t('the canary allow-list requires verified_at, and an unreadable list is not a canary', async () => {
  reset({ canary: true }); assert.equal(await sw.isCanaryDestination('sms', PHONE), true)
  reset({ canary: true, canaryError: true }); assert.equal(await sw.isCanaryDestination('sms', PHONE), false)
  reset({ canary: false }); assert.equal(await sw.isCanaryDestination('sms', PHONE), false)
})

console.log('\nCarrier opt-out → engine state (follow-up R13: a stop condition, no longer behind callback_engine_state)')
const closes = () => st.updates.filter((u) => ['comm_campaign_enrollments', 'life_campaign_enrollments', 'pipeline_winback_enrollments', 'xsell_life_campaign_enrollments', 'district_nurture_enrollments'].includes(u.table))
for (const [label, opts] of [['OFF (seeded / no row)', {}], ['canary, not a test destination', { mode: 'canary', canary: false }], ['ON', { mode: 'on' }]]) {
  await t(`${label}: a 21610 writes the opt-out AND closes every engine`, async () => {
    reset(opts)
    assert.deepEqual(await recordCarrierOptOut(PHONE, '21610'), { ok: true })
    const tables = new Set(closes().map((u) => u.table))
    for (const tb of ['comm_campaign_enrollments', 'life_campaign_enrollments', 'pipeline_winback_enrollments', 'xsell_life_campaign_enrollments', 'district_nurture_enrollments']) assert.ok(tables.has(tb), tb)
    for (const u of closes()) if (u.row.exit_reason) assert.equal(u.row.exit_reason, 'opted_out')
  })
}
await t('a non-opt-out code (30007 filtering): nothing written, nothing closed', async () => {
  reset({ mode: 'on' })
  await recordCarrierOptOut(PHONE, '30007')
  assert.equal(st.updates.length, 0)
})

console.log('\nThe migration seeds the switch OFF, with RLS and a rollback')
await t('140_automation_switches.sql', () => {
  const sql = readFileSync('supabase/migrations/140_automation_switches.sql', 'utf8')
  assert.match(sql, /mode\s+text not null default 'off' check \(mode in \('off', 'canary', 'on'\)\)/)
  assert.match(sql, /values \('callback_engine_state', 'off',/)
  assert.match(sql, /alter table automation_switches enable row level security/)
  assert.match(sql, /-- ROLLBACK:\n--\s+drop table if exists automation_switches;/)
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/i, 'no client-side write policy')
})

console.log(`\nAll ${passed} assertions passed.`)
