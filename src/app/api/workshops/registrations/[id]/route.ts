import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { RegistrationPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { convertRegistrationToLead } from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SLA_HOURS = 24

// PATCH /api/workshops/registrations/[id] — mark attendance and/or convert an attendee
// into a lead (docs/specs/workshops-seminar-design-spec.md §5,§7).
//   • convert_to_referral (legacy): seed the internal referral spine only.
//   • convert_to_lead (P1): seed the referral spine AND push into the existing consult
//     spine via GHL (upsert contact lead_source="Event" + tags, Pipeline-A prospect_client
//     opportunity). A securities-flagged (is_security=true) workshop is FIREWALLED: its
//     attendee routes to the FFS-supervised path (compliance escalation), never GHL / the
//     automated comms engine. Manual in P1; P2 automates it.
// Roles: fsa, licensed_staff, super_admin (the /app portal scope).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = RegistrationPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const { data: reg, error: rErr } = await db
      .from('workshop_registrations')
      .select('reg_id, workshop_id, name, email, phone, consent_channels, referral_id, status, attended, ghl_opportunity_id')
      .eq('reg_id', params.id)
      .maybeSingle()
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
    if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

    const update: Record<string, unknown> = {}
    if (typeof v.data.attended === 'boolean') update.attended = v.data.attended

    const wantLead = v.data.convert_to_lead === true
    const wantReferral = v.data.convert_to_referral === true

    // Load the workshop for the securities firewall + GHL attribution (slug/title).
    type WorkshopLeadRow = { is_security: boolean | null; slug: string | null; title: string | null }
    let workshop: WorkshopLeadRow | null = null
    if (wantLead || wantReferral) {
      const { data: w } = await db
        .from('workshops')
        .select('is_security, slug, title')
        .eq('workshop_id', reg.workshop_id)
        .maybeSingle()
      workshop = (w as WorkshopLeadRow | null) ?? null
    }

    // ── Securities firewall: a securities workshop's convert routes to FFS (no referral,
    //    no GHL, no automated comms). Handle first so we never seed the spine for it. ──
    if (wantLead && workshop?.is_security === true) {
      const outcome = await convertRegistrationToLead(
        db,
        { reg_id: reg.reg_id, name: reg.name, email: reg.email, phone: reg.phone, ghl_opportunity_id: reg.ghl_opportunity_id },
        { is_security: true, slug: workshop.slug, title: workshop.title },
        actor,
      )
      await db
        .from('workshop_registrations')
        .update({ ...update, status: 'ffs_referred' })
        .eq('reg_id', reg.reg_id)
      await writeAudit({
        actor,
        action: 'firewall.blocked',
        entity: 'workshop_registration',
        entityId: reg.reg_id,
        diff: { convert: 'securities_ffs' },
      })
      return NextResponse.json({ ok: true, routed: 'ffs', reason: outcome.ok && outcome.routed === 'ffs' ? outcome.reason : 'securities_ffs' })
    }

    // ── Seed the internal referral spine (shared by both convert paths). ──
    let referralId: string | null = reg.referral_id ?? null
    if ((wantReferral || wantLead) && !referralId) {
      const now = new Date()
      const { data: ref, error: refErr } = await db
        .from('referrals')
        .insert({
          referred_name: reg.name ?? 'Workshop attendee',
          referred_email: reg.email ?? null,
          referred_phone: reg.phone ?? null,
          engagement: 'direct',
          status: 'received',
          received_at: now.toISOString(),
          sla_due_at: new Date(now.getTime() + SLA_HOURS * 3600000).toISOString(),
          owner_scope: actor,
        })
        .select('id')
        .single()
      if (refErr || !ref) return NextResponse.json({ error: refErr?.message ?? 'Convert failed' }, { status: 500 })
      referralId = ref.id
      update.referral_id = referralId
      update.status = 'converted'

      const channels = Array.isArray(reg.consent_channels) ? (reg.consent_channels as string[]) : []
      if (channels.length > 0) {
        await db.from('activities').insert({
          entity_type: 'referral',
          entity_id: referralId,
          kind: 'consent_intent',
          note: `Consent captured at workshop registration: ${channels.join(', ')}`,
          actor,
        })
        await writeAudit({ actor, action: 'consent.captured', entity: 'referral', entityId: referralId, diff: { source: 'workshop', channels } })
      }
      await writeAudit({ actor, action: 'entity.created', entity: 'referral', entityId: referralId, diff: { source: 'workshop', registration_id: reg.reg_id } })
    }

    // ── convert_to_lead: push into the GHL consult spine (non-securities). ──
    if (wantLead) {
      const outcome = await convertRegistrationToLead(
        db,
        { reg_id: reg.reg_id, name: reg.name, email: reg.email, phone: reg.phone, ghl_opportunity_id: reg.ghl_opportunity_id },
        { is_security: false, slug: workshop?.slug ?? null, title: workshop?.title ?? null },
        actor,
      )
      if (!outcome.ok) {
        // GHL failed after retries — leave the registration converted internally but flag
        // the lead as un-pushed so staff can retry (no data loss).
        if (Object.keys(update).length > 0) await db.from('workshop_registrations').update(update).eq('reg_id', reg.reg_id)
        return NextResponse.json({ error: outcome.error, reason: 'ghl_push_failed', referral_id: referralId }, { status: outcome.status })
      }
      if (outcome.routed === 'ghl' && !outcome.skipped) {
        if (outcome.ghl_contact_id) update.ghl_contact_id = outcome.ghl_contact_id
        if (outcome.ghl_opportunity_id) update.ghl_opportunity_id = outcome.ghl_opportunity_id
        update.lead_converted_at = new Date().toISOString()
        await writeAudit({
          actor,
          action: 'entity.created',
          entity: 'ghl_opportunity',
          entityId: outcome.ghl_opportunity_id ?? reg.reg_id,
          diff: { source: 'workshop', pipeline: 'prospect_client', lead_source: 'Event', registration_id: reg.reg_id },
        })
      }
    }

    if (Object.keys(update).length > 0) {
      const { error: uErr } = await db.from('workshop_registrations').update(update).eq('reg_id', reg.reg_id)
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
      await writeAudit({ actor, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: update })
    }

    return NextResponse.json({ ok: true, referral_id: referralId, routed: wantLead ? 'ghl' : undefined })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update registration' }, { status: 500 })
  }
}
