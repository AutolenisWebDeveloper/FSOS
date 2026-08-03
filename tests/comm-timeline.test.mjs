// Unified comms/audit timeline shaping (src/lib/comms/timeline.ts) — pure, DB-free. Proves the
// status superset (incl. the P5.13 send-decision states), role-based redaction of bodies /
// recipients / provider ids, and the newest-first chronological merge. Run: node tests/comm-timeline.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-timeline-'))
execSync(
  `npx tsc src/lib/comms/timeline.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const T = require(join(out, 'timeline.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('status superset includes the P5.13 send-decision states and maps them to badges', () => {
  for (const s of ['suppressed', 'not_eligible', 'quiet_hours_deferred']) {
    assert.equal(T.normalizeStatus(s), s) // recognized, not coerced away
  }
  assert.equal(T.statusBadge('quiet_hours_deferred').key, 'pending')
  assert.equal(T.statusBadge('suppressed').key, 'blocked')
  assert.equal(T.statusBadge('not_eligible').label, 'not eligible')
  assert.equal(T.statusBadge('delivered').key, 'won')
  assert.equal(T.normalizeStatus('bogus'), 'queued') // defensive fallback
})

t('revealFor: FSA sees bodies/recipients but NOT provider ids; ops/compliance see provider ids', () => {
  const fsa = T.revealFor(['fsa'])
  assert.deepEqual(fsa, { bodies: true, recipients: true, providerIds: false })
  const ops = T.revealFor(['ops'])
  assert.deepEqual(ops, { bodies: false, recipients: false, providerIds: true })
  const compliance = T.revealFor(['compliance'])
  assert.deepEqual(compliance, { bodies: true, recipients: true, providerIds: true })
  // A partner/client role sees none of the sensitive fields.
  assert.deepEqual(T.revealFor(['agency_owner']), { bodies: false, recipients: false, providerIds: false })
})

t('redaction drops body/recipient/providerId when the role is not allowed', () => {
  const msg = { id: 'm1', channel: 'sms', direction: 'outbound', recipient: '+15551234567', body: 'Hi there', delivery_status: 'delivered', created_at: '2026-08-01T10:00:00Z' }
  const evt = { id: 'e1', event: 'delivered', channel: 'sms', detail: null, provider_id: 'SM_abc', created_at: '2026-08-01T10:01:00Z' }

  const redacted = T.mapMessage(msg, { bodies: false, recipients: false, providerIds: false })
  assert.equal(redacted.body, null)
  assert.equal(redacted.recipient, null)

  const revealed = T.mapMessage(msg, { bodies: true, recipients: true, providerIds: false })
  assert.equal(revealed.body, 'Hi there')
  assert.equal(revealed.recipient, '+15551234567')

  assert.equal(T.mapEvent(evt, { bodies: true, recipients: true, providerIds: false }).providerId, null)
  assert.equal(T.mapEvent(evt, { bodies: true, recipients: true, providerIds: true }).providerId, 'SM_abc')
})

t('audit note is surfaced only when bodies are revealed; raw diff is never dumped', () => {
  const a = { id: 7, actor: 'fsa@x.com', action: 'appointment.status.changed', diff: { note: 'client rescheduled', from: 'scheduled', to: 'completed' }, at: '2026-08-02T12:00:00Z' }
  assert.equal(T.mapAudit(a, { bodies: true, recipients: true, providerIds: true }).detail, 'client rescheduled')
  assert.equal(T.mapAudit(a, { bodies: false, recipients: false, providerIds: false }).detail, null)
  assert.equal(T.mapAudit(a, { bodies: true, recipients: true, providerIds: true }).title, 'Appointment Status Changed')
})

t('mergeTimeline orders newest-first across all three sources', () => {
  const messages = [{ id: 'm1', channel: 'email', direction: 'outbound', recipient: 'a@b.com', body: 'x', delivery_status: 'sent', created_at: '2026-08-01T09:00:00Z' }]
  const events = [{ id: 'e1', event: 'delivered', channel: 'email', detail: null, provider_id: 'p', created_at: '2026-08-01T09:05:00Z' }]
  const audits = [{ id: 1, actor: 'sys', action: 'appointment.created', diff: null, at: '2026-08-01T08:00:00Z' }]
  const merged = T.mergeTimeline(messages, events, audits, T.revealFor(['fsa']))
  assert.deepEqual(merged.map((e) => e.id), ['event:e1', 'message:m1', 'audit:1'])
})

console.log(`\nAll ${passed} assertions passed.`)
