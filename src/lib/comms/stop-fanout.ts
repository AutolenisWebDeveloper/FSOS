// src/lib/comms/stop-fanout.ts
// The ONE place an opt-out closes a member's live automation — native drips and the three
// campaign timelines. Shared by the inbound STOP / reply-stop handling (inbound.ts) and the
// carrier-opt-out consumer (opt-out.ts recordCarrierOptOut, behind the callback_engine_state
// switch). Relative imports only: opt-out.ts is part of the standalone chokepoint compile.

import { getDb } from '../supabase/client'
import { resolveAllMemberIds } from './conversations'

/**
 * TERMINATE the member's live enrollments across every campaign table — an ABSORBING state, not
 * a pause. Used by BOTH the carrier STOP path (§12, TCPA) and the natural-language stop-automation
 * path (FSOS-020).
 *
 * Pausing would be wrong in a way that matters: `resumePausedEnrollments` returns a
 * `paused_for_conversation` row to `enrolled`/live once the customer has been quiet for
 * `resume_quiet_days`, so a stop would silently re-enter the sending population. The terminal
 * states here (`opted_out` for the native drips; `exited`/`suppressed` for the three campaign
 * timelines) are NEVER selected by the resume job (it only selects `paused_for_conversation`) nor
 * by the tick engines (they only select the live status), and the `unique (campaign_id, member_id)`
 * constraint blocks re-enrollment of the same pair — so no cron, tick, retry, or eligibility pass
 * can silently resurrect it.
 *
 * `exitReason` distinguishes the cause on the campaign-timeline rows (and the native-drip
 * `suppressed_reason` carries `reason`) so a global carrier opt-out is auditable distinctly from a
 * campaign-only reply-stop. Returns how many enrollments were closed.
 */
export async function terminateActiveEnrollments(memberId: string, reason: string, exitReason: string): Promise<number> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  let closed = 0
  // Native drips: `opted_out` is terminal, and the resume job only ever selects
  // `paused_for_conversation`, so this can never be reinstated by automation.
  try {
    const { data } = await db
      .from('comm_campaign_enrollments')
      .update({ status: 'opted_out', suppressed_reason: reason, updated_at: nowISO })
      .in('status', ['enrolled', 'paused_for_conversation'])
      .eq('member_id', memberId)
      .select('id')
    closed += Array.isArray(data) ? data.length : 0
  } catch {
    /* best-effort — consent + DNC already block the sends */
  }
  // Campaign timelines. Life Conversion and Pipeline Win-Back use `exited`; Cross-Sell Life's
  // §15 machine has no `exited` state and uses `suppressed` for an excluded contact.
  for (const [table, terminal, live] of [
    ['life_campaign_enrollments', 'exited', ['active', 'paused_for_conversation', 'paused_by_admin']],
    ['pipeline_winback_enrollments', 'exited', ['active', 'paused_for_conversation', 'paused_by_admin']],
    [
      'xsell_life_campaign_enrollments',
      'suppressed',
      ['queued', 'scheduled', 'enrolled', 'running', 'paused_for_conversation', 'paused_by_admin', 'conversation_active'],
    ],
  ] as const) {
    try {
      const { data } = await db
        .from(table)
        .update({ status: terminal, exit_reason: exitReason, completed_at: nowISO, updated_at: nowISO })
        .in('status', live as unknown as string[])
        .eq('member_id', memberId)
        .select('id')
      closed += Array.isArray(data) ? data.length : 0
    } catch {
      /* best-effort — table/column absent tolerated */
    }
  }
  return closed
}

/**
 * Close live automation for every household member at an address (a shared phone or inbox
 * governs all of them — audit B-04). Returns how many enrollments were closed. Never throws.
 */
export async function terminateAutomationForAddress(
  channel: 'sms' | 'email',
  contact: string,
  reason: string,
  exitReason: string,
): Promise<number> {
  let closed = 0
  try {
    for (const memberId of await resolveAllMemberIds(channel, contact)) {
      closed += await terminateActiveEnrollments(memberId, reason, exitReason)
    }
  } catch {
    /* best-effort — DNC + consent already block every send */
  }
  return closed
}
