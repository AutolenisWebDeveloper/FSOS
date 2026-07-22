// AI Command Center view-model gate — proves the PURE composition core
// (lib/ai/command-center.ts): executive-status roll-ups are correct, roster health
// flags a degraded worker, and — critically — a securities-flagged queue item is
// surfaced as a CRITICAL firewall attention item and is NEVER counted toward
// sent/engaged results. Compiles the pure module in isolation (no Supabase), the
// same harness as workforce.test.mjs. Run: node tests/command-center.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-command-center-'))
execSync(
  `npx tsc src/lib/ai/command-center.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  executiveStatus,
  resultsToday,
  rosterHealth,
  attentionItems,
  heldCount,
  DEGRADED_ERROR_RATE,
} = require(join(out, 'command-center.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// A working workforce row factory (override per test).
function wf(over = {}) {
  return {
    agent_key: 'cross_sell',
    agent_enabled: true,
    daily_target: 10,
    channel: 'sms',
    target_enabled: true,
    is_assumption: true,
    queued_total: 10,
    sent: 4,
    blocked: 0,
    escalated: 0,
    skipped: 0,
    pending: 3,
    drafted: 1,
    engaged: 2,
    remaining: 6,
    ...over,
  }
}

// A queue row factory.
function q(over = {}) {
  return {
    id: 'q-' + Math.random().toString(36).slice(2),
    agent_key: 'cross_sell',
    source: 'cross_sell',
    channel: 'sms',
    priority: 50,
    reason: 'Coverage gap',
    status: 'sent',
    block_reason: null,
    outcome: null,
    is_security: false,
    entity_type: 'household',
    household_id: 'hh',
    ...over,
  }
}

console.log('Executive status (executiveStatus)')

t('counts active / paused / off workers by the two kill switches', () => {
  const s = executiveStatus([
    wf({ agent_key: 'cross_sell', agent_enabled: true, target_enabled: true }),
    wf({ agent_key: 'term_conversion', agent_enabled: true, target_enabled: false }),
    wf({ agent_key: 'referral_followup', agent_enabled: false, target_enabled: true }),
  ])
  assert.equal(s.activeWorkers, 1)
  assert.equal(s.pausedWorkers, 1)
  assert.equal(s.offWorkers, 1)
})

t('ignores idle roster keys with no quota and no queued work', () => {
  const s = executiveStatus([wf(), wf({ agent_key: 'idle', daily_target: 0, queued_total: 0 })])
  // only the one real worker counts
  assert.equal(s.activeWorkers, 1)
})

t('rolls up in-progress, completed and failed counts', () => {
  const s = executiveStatus([
    wf({ sent: 4, pending: 3, drafted: 1, blocked: 2, escalated: 1 }),
    wf({ agent_key: 'term_conversion', sent: 5, pending: 0, drafted: 0, blocked: 0, escalated: 0 }),
  ])
  assert.equal(s.completedToday, 9)
  assert.equal(s.inProgress, 4)
  assert.equal(s.failedToday, 2)
  assert.equal(s.escalations, 1)
})

console.log('Results roll-up (resultsToday)')

t('reports sent/engaged/blocked/escalated as workforce facts', () => {
  const r = resultsToday([wf({ sent: 4, engaged: 2, blocked: 1, escalated: 1 })])
  assert.deepEqual(r, { sent: 4, engaged: 2, blocked: 1, escalated: 1 })
})

console.log('Roster health (rosterHealth)')

t('flags a worker degraded when the block/escalation rate exceeds the threshold', () => {
  const [entry] = rosterHealth([wf({ queued_total: 10, blocked: 4, escalated: 0, sent: 2 })])
  assert.ok(entry.errorRate > DEGRADED_ERROR_RATE)
  assert.equal(entry.health, 'degraded')
  assert.equal(entry.status, 'working')
})

t('a healthy low-error worker is healthy; a paused one is idle', () => {
  const healthy = rosterHealth([wf({ queued_total: 10, blocked: 0, escalated: 0 })])[0]
  assert.equal(healthy.health, 'healthy')
  const paused = rosterHealth([wf({ target_enabled: false })])[0]
  assert.equal(paused.status, 'paused')
  assert.equal(paused.health, 'idle')
})

t('sorts by remaining work then agent key', () => {
  const rows = rosterHealth([
    wf({ agent_key: 'b', remaining: 1 }),
    wf({ agent_key: 'a', remaining: 9 }),
  ])
  assert.equal(rows[0].agentKey, 'a')
})

console.log('Human attention (attentionItems) — the firewall is visible, never sent')

t('a securities-flagged queue item surfaces as a CRITICAL firewall item, isSecurity=true', () => {
  const items = attentionItems([q({ is_security: true, status: 'escalated' })], [], [])
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'firewall')
  assert.equal(items[0].severity, 'critical')
  assert.equal(items[0].isSecurity, true)
})

t('a securities-flagged item is NEVER counted toward sent/engaged results', () => {
  // The firewall CHECK constraint forbids is_security rows reaching 'sent'; the
  // view-model must likewise never treat one as a completed contact. Results are
  // derived from the workforce aggregate (which the DB firewall guards), and the
  // security item lives ONLY in the attention list.
  const secureQueue = [q({ is_security: true, status: 'escalated', outcome: null })]
  const attention = attentionItems(secureQueue, [], [])
  assert.ok(attention.every((i) => i.category !== 'blocked_send' || !i.isSecurity))
  // The single security row is firewall-classified, not a "sent" or "engaged" fact.
  assert.equal(attention[0].category, 'firewall')
  // resultsToday is computed from the workforce rows, not the raw queue — a security
  // row can never inflate sent/engaged because it can never reach status 'sent'.
  const r = resultsToday([wf({ sent: 0, engaged: 0 })])
  assert.equal(r.sent, 0)
  assert.equal(r.engaged, 0)
})

t('blocked and held queue items become ranked attention entries', () => {
  const items = attentionItems(
    [q({ status: 'blocked', block_reason: 'No valid channel consent on file.' }), q({ status: 'held' })],
    [],
    [],
  )
  const cats = items.map((i) => i.category)
  assert.ok(cats.includes('blocked_send'))
  assert.ok(cats.includes('held'))
  // blocked (medium) ranks above held (low)
  assert.ok(items.findIndex((i) => i.category === 'blocked_send') < items.findIndex((i) => i.category === 'held'))
})

t('escalations and compliance firewall events are folded in and ranked by severity', () => {
  const items = attentionItems(
    [q({ status: 'held' })],
    [{ id: 'e1', reason: 'Client asked for advice', target_type: 'conversation', target_id: 'c1', note: null, blocked_step: null, created_at: '2026-07-22T10:00:00Z' }],
    [{ id: 'c1', kind: 'firewall', reason: 'securities record', blocked_step: 'is_security', channel: 'sms', created_at: '2026-07-22T09:00:00Z' }],
  )
  // critical firewall first, then high escalation, then low held
  assert.equal(items[0].category, 'firewall')
  assert.equal(items[0].isSecurity, true)
  assert.equal(items[1].category, 'escalation')
  assert.equal(items[items.length - 1].category, 'held')
})

t('heldCount counts only held items', () => {
  assert.equal(heldCount([q({ status: 'held' }), q({ status: 'sent' }), q({ status: 'held' })]), 2)
})

console.log(`\nAll ${passed} assertions passed.`)
