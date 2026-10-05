import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { recordConsentChange } from '@/lib/comms/consent-events'
import { householdIdFor } from '@/lib/portal/scope'
import { armDncEntry, applyDocumentedReconsent, smsStopNeedsStart } from '@/lib/comms/opt-out'
import { SMS_CONSENT } from '@/lib/site'
import { consentContactKey } from '@/lib/comms/contact-consent'
import { getCurrentUserEmail } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Schema = z.object({ channel: z.enum(['call', 'sms', 'email']), status: z.enum(['granted', 'revoked']) })

// P-5 client consent management. A client may only manage THEIR OWN household's
// consent (RLS-aligned). Revocation is instant + global — it updates consents AND
// adds a DNC entry so it is authoritative over every campaign/agent before the next
// send (WF-9 invariant: re-checked at send time).
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('client')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = Schema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const householdId = await householdIdFor(auth.session)
    if (!householdId) return NextResponse.json({ error: 'No household scope.' }, { status: 403 })

    // A REVOKE covers every member of the household on the channel; a GRANT covers only the signed-in
    // member (follow-up R1: one person's toggle is not another person's consent). Read the prior status
    // first so each consent change records its true previous→new transition (audit + CRM timeline).
    const { data: members } = await db
      .from('household_members')
      .select('id, email, phone, consents(channel, status)')
      .eq('household_id', householdId)
    // A failed DNC write must not leave the member's consent change unaudited or skip the other
    // members: record every change, then fail the request so the client retries.
    let dncFailed = false
    let grantFailed = false
    let textStart = false
    // A re-consent clears earlier opt-outs only for the signed-in client's OWN address (review F2):
    // a household member's STOP or unsubscribe is theirs, and a spouse's toggle must not lift it.
    // The member is the one whose email is the signed-in user's; no unique match → nothing is lifted.
    const signedInEmail = (await getCurrentUserEmail())?.trim().toLowerCase() ?? null
    const own = (members ?? []).filter((m) => !!signedInEmail && String(m.email ?? '').trim().toLowerCase() === signedInEmail)
    const selfMemberId = own.length === 1 ? own[0].id : null
    if (v.data.status === 'granted' && !selfMemberId) {
      return NextResponse.json(
        { error: "We couldn't match your sign-in to a member of this household, so nothing was changed. Please contact us." },
        { status: 409 },
      )
    }
    for (const m of members ?? []) {
      if (v.data.status === 'granted' && m.id !== selfMemberId) continue
      const prior = (m as { consents?: { channel: string; status: string }[] }).consents?.find(
        (c) => c.channel === v.data.channel,
      )
      await db.from('consents').upsert({ member_id: m.id, household_id: householdId, channel: v.data.channel, status: v.data.status, source: 'client_portal', captured_at: new Date().toISOString() }, { onConflict: 'member_id,channel' })
      // Revocation → add to DNC so the gate blocks before the next send anywhere.
      if (v.data.status === 'revoked') {
        const contact = v.data.channel === 'email' ? m.email : m.phone
        // The shared DNC writer: never relabels an existing row, re-arms one a bare START had lifted,
        // and records the opt-out as contact-level evidence so a later START cannot lift it.
        if (contact) {
          const ch = v.data.channel
          const key = ch === 'call' ? contact : consentContactKey(ch, contact)
          const dnc = await armDncEntry({ contact: key, channel: ch, reason: 'client opt-out' })
          if (!dnc.ok) dncFailed = true
        }
      }
      // A documented re-consent by the client clears the earlier opt-outs on this channel (owner,
      // round 3) — except a hard bounce, which only re-verifying the address clears.
      if (v.data.status === 'granted' && v.data.channel !== 'call') {
        const contact = v.data.channel === 'email' ? m.email : m.phone
        if (contact) {
          // Owner decision (round 4), copy only: a STOP stays blocked at the carrier until START.
          if (v.data.channel === 'sms' && (await smsStopNeedsStart(contact))) textStart = true
          const rc = await applyDocumentedReconsent({
            contact: consentContactKey(v.data.channel, contact),
            channel: v.data.channel,
            source: 'client_portal',
            recordGrant: true,
            actor,
            memberId: m.id,
            householdId,
          })
          if (!rc.ok) grantFailed = true
        }
      }
      // ONE consent-logging path → audit_log AND the CRM timeline (§C).
      await recordConsentChange({
        actor,
        channel: v.data.channel,
        newStatus: v.data.status,
        previousStatus: (prior?.status as 'granted' | 'revoked' | undefined) ?? 'none',
        source: 'client_portal',
        reason: 'client self-service preference change',
        memberId: m.id,
        householdId,
      })
    }
    if (dncFailed) return NextResponse.json({ error: 'Could not record the opt-out. Please try again.' }, { status: 500 })
    if (grantFailed) return NextResponse.json({ error: 'Could not record your preference. Please try again.' }, { status: 500 })
    return NextResponse.json(textStart ? { ok: true, textStart: { number: SMS_CONSENT.from } } : { ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
