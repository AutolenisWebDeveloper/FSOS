// src/lib/comms/deliverability.ts
// Impure orchestrator: turns a Resend email-deliverability event (hard bounce /
// spam complaint) into a suppression through the ONE existing enforced path
// (suppressContact → dnc_entries), which gate step 3 (§12) already blocks on.
//
// This deliberately reuses the established suppression machinery instead of adding a
// parallel store (§6 — one suppression subsystem). The pure decision lives in
// deliverability-core.ts; the actual write, member/household anchoring, and audit /
// consent-revoke are all handled by suppressContact().

import { suppressContact } from './unsubscribe'
import {
  classifyDeliverabilityEvent,
  suppressionProvenanceFor,
  type BouncePayload,
  type DeliverabilityEvent,
  type DeliverabilityReason,
} from './deliverability-core'

export interface DeliverabilitySuppressionInput {
  event: DeliverabilityEvent
  bounce?: BouncePayload | null
  /** The recipient email (from the stored comm_messages row, else the event payload). */
  email?: string | null
}

/**
 * Suppress the recipient's email channel when the event warrants it. Returns
 * `{ suppressed: false }` (no-op) for soft/transient bounces or a missing address —
 * never throws (suppressContact is itself best-effort). The truthful cause is recorded
 * on dnc_entries.reason and the consent-revoke audit via provenance.
 */
export async function applyDeliverabilitySuppression(
  input: DeliverabilitySuppressionInput,
): Promise<{ suppressed: boolean; reason?: DeliverabilityReason }> {
  const decision = classifyDeliverabilityEvent(input.event, input.bounce ?? null)
  if (!decision) return { suppressed: false }

  const email = (input.email ?? '').trim()
  if (!email) return { suppressed: false }

  const res = await suppressContact(email, 'email', suppressionProvenanceFor(decision.reason))
  return { suppressed: res.ok, reason: decision.reason }
}
