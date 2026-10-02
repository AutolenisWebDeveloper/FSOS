// A reply or stop from a phone SHARED by several household members must reach every one of
// their automations — not only the member the thread happens to be linked to (audit B-04).
// Two members share one mobile here. A natural-language stop terminates BOTH members'
// enrollments and suppresses BOTH contacts; a benign reply pauses BOTH; a STOP keyword
// terminates BOTH. Drives the REAL processInbound against an in-memory database.
// Run: node tests/comms-shared-address-stops.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'fsos-shared-addr-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
try {
  execSync(
    `npx tsc src/lib/comms/inbound.ts src/lib/comms/conversations.ts src/lib/comms/keywords.ts src/lib/comms/opt-out.ts ` +
      `src/lib/booking/optout-appointment-review.ts src/lib/site.ts --rootDir src --outDir ${out} --module commonjs ` +
      `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch { /* unresolved '@/…' aliases are expected */ }
if (!existsSync(join(out, 'lib/comms/inbound.js'))) { console.error('FATAL: inbound.js was not emitted'); process.exit(1) }

const PHONE = '+15125550199'
let state
function reset() {
  state = {
    conversations: [],
    updates: [],
    suppressionCalls: [],
    members: [
      { id: 'mem-a', household_id: 'hh-1', phone: '5125550199', source_contact_id: 'c-a' },
      { id: 'mem-b', household_id: 'hh-1', phone: '(512) 555-0199', source_contact_id: 'c-b' },
      { id: 'mem-c', household_id: 'hh-2', phone: '5125550100', source_contact_id: 'c-c' },
    ],
  }
}
function makeDb() {
  const from = (table) => {
    const filters = {}
    let op = 'select', payload = null
    const b = {
      select: () => b, in: () => b, gt: () => b, ilike: () => b, is: () => b, order: () => b, limit: () => b,
      eq: (c, v) => { filters[c] = v; return b },
      insert: (row) => {
        op = 'insert'; payload = row
        if (table === 'comm_conversations') { payload = { id: `conv-${state.conversations.length + 1}`, unread_count: 0, ...row }; state.conversations.push(payload) }
        return b
      },
      update: (row) => { op = 'update'; payload = row; return b },
      upsert: (row) => { op = 'upsert'; payload = row; return b },
      delete: () => { op = 'delete'; return b },
      async maybeSingle() {
        if (op === 'insert') return { data: payload?.id ? payload : { id: 'row-1' }, error: null }
        if (table === 'comm_conversations') {
          const hit = state.conversations.find((c) => (!filters.channel || c.channel === filters.channel) && (!filters.contact || c.contact === filters.contact) && (!filters.id || c.id === filters.id))
          return { data: hit ?? null, error: null }
        }
        if (table === 'household_members' && filters.id) {
          const m = state.members.find((x) => x.id === filters.id)
          return { data: m ? { source_contact_id: m.source_contact_id, household_id: m.household_id } : null, error: null }
        }
        if (table === 'household_members') { const m = state.members[0]; return { data: m, error: null } }
        return { data: null, error: null }
      },
      then: (resolve) => {
        if (op === 'update') { state.updates.push({ table, row: payload, filters: { ...filters } }); return resolve({ data: [], error: null }) }
        if (table === 'household_members') return resolve({ data: state.members, error: null })
        return resolve({ data: [], error: null })
      },
    }
    return b
  }
  return { from, rpc: async () => ({ data: null, error: null }) }
}
const db = makeDb()
const makeStub = () => new Proxy(function () {}, {
  get: (_t, prop) => (prop === '__esModule' ? true : prop === 'then' ? undefined : makeStub()),
  apply: () => makeStub(),
})
const HOOKS = {
  '@/lib/supabase/client': { __esModule: true, getDb: () => db },
  '@/lib/audit/log': { __esModule: true, writeAudit: async () => ({ ok: true }) },
  '@/lib/ai/responder': { __esModule: true, draftReply: async () => null },
}
const SUPPRESSION = { __esModule: true, applySuppression: async (args) => { state.suppressionCalls.push(args); return { ok: true } } }
const RELATIVE_STUBS = new Set(['./send', './events', './turn-limit', './consent-events'])
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (HOOKS[request]) return HOOKS[request]
  if (request.endsWith('/supabase/client')) return HOOKS['@/lib/supabase/client']
  if (request === './suppression-admin') return SUPPRESSION
  if (RELATIVE_STUBS.has(request)) return makeStub()
  if (request.startsWith('@/')) return makeStub()
  return origLoad.call(this, request, ...rest)
}
const { processInbound } = require(join(out, 'lib/comms/inbound.js'))

const touched = (status) => [...new Set(state.updates.filter((u) => u.row?.status === status).map((u) => u.filters.member_id))].sort()

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('Stop conditions reach every member sharing the address (B-04)')

reset()
await processInbound({ channel: 'sms', from: PHONE, body: 'please stop texting me' })
await t('a natural-language stop terminates BOTH sharing members', async () => {
  assert.deepEqual(touched('opted_out'), ['mem-a', 'mem-b'])
  assert.ok(!touched('opted_out').includes('mem-c'), 'a different number is untouched')
})
await t('…and business-suppresses BOTH members’ contacts', async () => {
  assert.equal(state.suppressionCalls.length, 1)
  assert.deepEqual([...state.suppressionCalls[0].contactIds].sort(), ['c-a', 'c-b'])
})

reset()
await processInbound({ channel: 'sms', from: PHONE, body: 'sure, what time works?' })
await t('a benign reply pauses BOTH sharing members', async () => {
  assert.deepEqual(touched('paused_for_conversation'), ['mem-a', 'mem-b'])
})

reset()
await processInbound({ channel: 'sms', from: PHONE, body: 'STOP' })
await t('a STOP keyword terminates BOTH sharing members', async () => {
  assert.deepEqual(touched('opted_out'), ['mem-a', 'mem-b'])
})
console.log(`\nAll ${passed} assertions passed.`)
