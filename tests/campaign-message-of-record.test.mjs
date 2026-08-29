// MESSAGE-OF-RECORD attribution proof (audit finding F-1). The three engine ticks used to pass
// their OWN per-campaign-table id (life_campaigns.id / xsell_life_campaigns.id /
// pipeline_winback_campaigns.id) as `campaignId`, which lands in comm_messages.campaign_id — a
// column whose foreign key targets comm_campaigns (a DIFFERENT table). Every insert therefore
// failed the FK (silently, into an ignored `error`), so NO message-of-record and NO event-ledger
// row was ever written for a campaign send (88 sends, 0 records in production).
//
// The fix: pass campaignId=null (never a World-2 id into the World-1 FK) and attribute the campaign
// via source provenance (source_kind='campaign_asset', source_campaign_key=<family>) + the entity
// linkage (entity → <engine>_enrollment → campaign). This drives the REAL fireMessageTouch of each
// engine with a spy that CAPTURES the sendMessage context and asserts the corrected attribution.
//
// Pre-fix, ctx.campaignId === the enrollment's campaign_id ('c1' here); post-fix it is null. That is
// the exact difference that broke (and now restores) the message-of-record.
// Run: node tests/campaign-message-of-record.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)

const engines = [
  { key: 'life', src: 'src/lib/life-campaign/tick.ts', family: 'life_conversion', entity: 'life_campaign_enrollment' },
  { key: 'xsell', src: 'src/lib/cross-sell-life/tick.ts', family: 'cross_sell_life', entity: 'xsell_life_campaign_enrollment' },
  { key: 'pw', src: 'src/lib/pipeline-winback/tick.ts', family: 'pipeline_winback', entity: 'pipeline_winback_enrollment' },
]

for (const eng of engines) {
  eng.out = mkdtempSync(join(tmpdir(), `fsos-mor-${eng.key}-`))
  try {
    execSync(
      `npx tsc ${eng.src} --outDir ${eng.out} --module commonjs --target es2020 ` +
        `--moduleResolution node --skipLibCheck --esModuleInterop`,
      { stdio: 'ignore' },
    )
  } catch { /* expected TS2307 on '@/…' aliases; JS still emits */ }
  if (!existsSync(join(eng.out, 'tick.js'))) { console.error(`FATAL: ${eng.key} tick.js not emitted`); process.exit(1) }
}

let captured = null
const sendModuleStub = {
  __esModule: true,
  sendMessage: async (ctx) => { captured = ctx; return { sent: true, blocked: false } },
  isTemplateApproved: async () => true,
}
const makeStub = () => new Proxy(function () {}, {
  get: (_t, prop) => (prop === '__esModule' ? true : makeStub()),
  apply: () => makeStub(),
})
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === '@/lib/comms/send') return sendModuleStub
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return makeStub()
  return origLoad.call(this, request, ...rest)
}
const impls = {}
for (const eng of engines) impls[eng.key] = require(join(eng.out, 'tick.js')).fireMessageTouch

// Reachable member so a valid template reaches sendMessage (see the fail-closed test for why).
const MEMBER = { email: 'client@example.com', phone: '+15550100', full_name: 'Client Name' }
function makeDb() {
  const from = (table) => {
    const b = {
      select: () => b, eq: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({
        data: table === 'comm_templates'
          ? { channel: 'email', body: 'Subject: Your review\n\nHello there.', introduces_sender: false }
          : (table === 'household_members' || table === 'contacts') ? MEMBER
          : null,
        error: null,
      }),
      update: () => b, insert: () => b,
    }
    return b
  }
  return { from }
}

const baseE = {
  id: 'enr1', member_id: 'm1', contact_id: null, household_id: 'h1', agency_id: 'a1',
  policy_id: 'p1', campaign_id: 'c1', baseline_date: '2026-01-01', current_touch_no: 0,
}
const cfg = { id: 'c1', purpose: 'MARKETING' }
const touch = { touch_no: 1, kind: 'email', template_id: 'tpl1', asset_label: null }
const dispatchCtx = { purpose: 'MARKETING', delegation: undefined, ownership: undefined }
const NOW = '2026-08-10T16:00:00.000Z'

const results = []
const record = (name, fn) => Promise.resolve().then(fn).then(
  () => { results.push({ name, pass: true }); console.log(`  ✓ ${name}`) },
  (e) => { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) },
)

for (const eng of engines) {
  console.log(`\n${eng.key} — message-of-record attribution`)
  captured = null
  await impls[eng.key](makeDb(), cfg, { ...baseE }, 1, { ...touch }, dispatchCtx, NOW)

  await record(`${eng.key}: sendMessage was invoked`, () => assert.ok(captured, 'no dispatch captured'))
  await record(`${eng.key}: campaignId is NULL (never the World-2 id 'c1' into the comm_campaigns FK)`, () => {
    assert.notEqual(captured.campaignId, 'c1', 'still passing the per-campaign-table id — FK would fail')
    assert.equal(captured.campaignId ?? null, null)
  })
  await record(`${eng.key}: entity links the message-of-record to the enrollment`, () => {
    assert.equal(captured.entity.type, eng.entity)
    assert.equal(captured.entity.id, 'enr1')
  })
  await record(`${eng.key}: provenance source_kind = campaign_asset`, () =>
    assert.equal(captured.sourceKind, 'campaign_asset'))
  await record(`${eng.key}: provenance source_campaign_key = ${eng.family}`, () =>
    assert.equal(captured.sourceCampaignKey, eng.family))
}
Module._load = origLoad

const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} message-of-record assertion(s) FAILED — build-blocking.`); process.exit(1) }
console.log(`\nAll ${results.length} message-of-record proofs passed (F-1: campaign sends no longer feed a bad FK; attribution preserved).`)
