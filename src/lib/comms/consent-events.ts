// src/lib/comms/consent-events.ts
// The SINGLE consent-change logging path (§12/§13.9, ADR-003 audit fidelity). Every
// consent transition — grant, revoke, suppress, restore, and the bulk existing-client
// population (§B) — is recorded to BOTH:
//   • the append-only audit_log (compliance evidence: who/what/when/prev→new/source), and
//   • the CRM timeline (activities), so the change is visible on the customer 360 next to
//     everything else that happened to the household/member.
//
// The pure builders here have NO database or clock imports so they are unit-testable
// offline (tests/consent-events.test.mjs) — matching the standard FSOS pure-core → impure-
// recorder pattern. recordConsentChange() is the impure recorder (dynamic imports, mirroring
// dispatcher.ts) that writes both stores; it never throws into its caller (a consent
// mutation's own success must not be reversed by a logging hiccup), but an audit failure is
// surfaced by writeAudit's result for monitoring.

import type { AuditEntry } from '../audit/log'

export type ConsentEventChannel = 'sms' | 'email' | 'call'
/** The consent state BEFORE the change — 'none' when no prior row existed. */
export type ConsentState = 'granted' | 'revoked' | 'none'

export interface ConsentChange {
  /** Authenticated user id, an agent key, or 'system'. */
  actor: string
  channel: ConsentEventChannel
  /** The new consent state this change establishes. 'suppress' is modeled as 'revoked'. */
  newStatus: 'granted' | 'revoked'
  /** Prior state for the audit diff + timeline note. Unknown → omit/null. */
  previousStatus?: ConsentState | null
  /** Provenance label (e.g. 'existing_client_optin', 'client_portal', 'inbound_stop'). */
  source: string
  /** Human reason / extra context (e.g. 'inbound STOP', 'unsubscribe one-click'). */
  reason?: string | null
  /** The member this consent is for (preferred timeline anchor). */
  memberId?: string | null
  /** The household (timeline anchor when no member id; also stored for context). */
  householdId?: string | null
}

/** The audit action verb for a consent transition (data-api-map §4 taxonomy). */
export function consentAuditAction(newStatus: 'granted' | 'revoked'): AuditEntry['action'] {
  return newStatus === 'revoked' ? 'consent.revoked' : 'consent.captured'
}

/**
 * The entity a consent change attaches to: the member when known (so it lands on the
 * member's timeline), else the household, else a bare 'contact' (audit-only — no timeline
 * anchor). Returned as { entity, entityId } so both builders agree on the anchor.
 */
function consentAnchor(c: ConsentChange): { entity: string; entityId: string | null } {
  if (c.memberId) return { entity: 'household_member', entityId: c.memberId }
  if (c.householdId) return { entity: 'household', entityId: c.householdId }
  return { entity: 'contact', entityId: null }
}

/** Build the append-only audit_log entry for a consent change (never securities data). */
export function buildConsentAuditEntry(c: ConsentChange): AuditEntry {
  const { entity, entityId } = consentAnchor(c)
  return {
    actor: c.actor,
    action: consentAuditAction(c.newStatus),
    entity,
    entityId,
    diff: {
      channel: c.channel,
      previous_status: c.previousStatus ?? null,
      new_status: c.newStatus,
      source: c.source,
      reason: c.reason ?? null,
      household_id: c.householdId ?? null,
      member_id: c.memberId ?? null,
    },
  }
}

/**
 * Build the CRM-timeline (activities) row for a consent change, or null when there is no
 * member/household to anchor it to (a bare-contact change is audit-only). The activities
 * table shape is { entity_type, entity_id, kind, note, actor }.
 */
export function buildConsentActivityRow(
  c: ConsentChange,
): { entity_type: string; entity_id: string; kind: string; note: string; actor: string } | null {
  const { entity, entityId } = consentAnchor(c)
  if (!entityId) return null
  const prev = c.previousStatus && c.previousStatus !== 'none' ? ` (was ${c.previousStatus})` : ''
  const reason = c.reason ? `; ${c.reason}` : ''
  const verb = c.newStatus === 'revoked' ? 'revoked' : 'granted'
  return {
    entity_type: entity,
    entity_id: entityId,
    kind: `consent_${verb}`,
    note: `Consent ${verb} for ${c.channel}${prev} — source: ${c.source}${reason}`,
    actor: c.actor,
  }
}

/**
 * Record ONE consent change to both the audit_log and the CRM timeline. Impure; dynamic
 * imports keep the pure builders above offline-testable and mirror dispatcher.ts's style.
 * Best-effort on the timeline write (never reverses the mutation); the audit result is
 * returned so an un-audited consent change can be surfaced/monitored (DoD §21).
 */
export async function recordConsentChange(c: ConsentChange): Promise<{ audited: boolean }> {
  const { writeAudit } = await import('../audit/log')
  const res = await writeAudit(buildConsentAuditEntry(c))
  const row = buildConsentActivityRow(c)
  if (row) {
    try {
      const { getDb } = await import('../supabase/client')
      await getDb().from('activities').insert(row)
    } catch {
      /* best-effort timeline — the audit_log entry above is the durable compliance record */
    }
  }
  return { audited: res.ok }
}
