// §C — the SINGLE consent-change logging path. Proves the PURE builders offline: every
// consent transition produces BOTH an append-only audit_log entry AND a CRM-timeline
// (activities) row anchored to the member (else household), with prev→new/source/reason.
// No DB, no server. Run: node tests/consent-events.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-consent-events-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

// Compile the pure builders. consent-events.ts's recordConsentChange uses dynamic imports
// (audit/log, supabase/client) — the same pattern dispatcher.ts uses in campaign-gate.test.
execSync(
  `npx tsc src/lib/comms/consent-events.ts src/lib/audit/log.ts src/lib/supabase/client.ts src/lib/env.ts ` +
    `--rootDir src/lib --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { buildConsentAuditEntry, buildConsentActivityRow, consentAuditAction } = require(
  join(out, 'comms/consent-events.js'),
)

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('consentAuditAction (taxonomy)')
t('granted → consent.captured, revoked → consent.revoked', () => {
  assert.equal(consentAuditAction('granted'), 'consent.captured')
  assert.equal(consentAuditAction('revoked'), 'consent.revoked')
})

console.log('buildConsentAuditEntry (append-only evidence)')
t('grant anchors to the member with a full prev→new diff', () => {
  const e = buildConsentAuditEntry({
    actor: 'system',
    channel: 'sms',
    newStatus: 'granted',
    previousStatus: 'none',
    source: 'existing_client_optin',
    memberId: 'm1',
    householdId: 'h1',
  })
  assert.equal(e.action, 'consent.captured')
  assert.equal(e.entity, 'household_member')
  assert.equal(e.entityId, 'm1')
  assert.equal(e.diff.channel, 'sms')
  assert.equal(e.diff.new_status, 'granted')
  assert.equal(e.diff.previous_status, 'none')
  assert.equal(e.diff.source, 'existing_client_optin')
})

t('revoke → consent.revoked; carries the reason', () => {
  const e = buildConsentAuditEntry({
    actor: 'system',
    channel: 'sms',
    newStatus: 'revoked',
    previousStatus: 'granted',
    source: 'inbound_stop',
    reason: 'inbound STOP',
    memberId: 'm2',
  })
  assert.equal(e.action, 'consent.revoked')
  assert.equal(e.diff.reason, 'inbound STOP')
  assert.equal(e.diff.previous_status, 'granted')
})

t('no member → anchors to the household', () => {
  const e = buildConsentAuditEntry({
    actor: 'u1',
    channel: 'email',
    newStatus: 'granted',
    source: 'client_portal',
    householdId: 'h9',
  })
  assert.equal(e.entity, 'household')
  assert.equal(e.entityId, 'h9')
})

t('no member and no household → audit-only bare contact', () => {
  const e = buildConsentAuditEntry({ actor: 'system', channel: 'email', newStatus: 'revoked', source: 'unsubscribe' })
  assert.equal(e.entity, 'contact')
  assert.equal(e.entityId, null)
})

console.log('buildConsentActivityRow (CRM timeline)')
t('grant → consent_granted activity on the member timeline', () => {
  const a = buildConsentActivityRow({
    actor: 'system',
    channel: 'sms',
    newStatus: 'granted',
    previousStatus: 'none',
    source: 'existing_client_optin',
    memberId: 'm1',
    householdId: 'h1',
  })
  assert.equal(a.entity_type, 'household_member')
  assert.equal(a.entity_id, 'm1')
  assert.equal(a.kind, 'consent_granted')
  assert.match(a.note, /granted for sms/)
  assert.match(a.note, /existing_client_optin/)
})

t('revoke note shows the previous state and reason', () => {
  const a = buildConsentActivityRow({
    actor: 'system',
    channel: 'sms',
    newStatus: 'revoked',
    previousStatus: 'granted',
    source: 'inbound_stop',
    reason: 'inbound STOP',
    memberId: 'm2',
  })
  assert.equal(a.kind, 'consent_revoked')
  assert.match(a.note, /revoked for sms/)
  assert.match(a.note, /was granted/)
  assert.match(a.note, /inbound STOP/)
})

t('bare contact (no anchor) → null timeline row (audit-only)', () => {
  const a = buildConsentActivityRow({ actor: 'system', channel: 'email', newStatus: 'revoked', source: 'unsubscribe' })
  assert.equal(a, null)
})

console.log(`\n✓ consent-events: ${passed} assertions passed`)
