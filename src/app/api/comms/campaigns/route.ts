import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { CampaignCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-12 Campaigns. A campaign CANNOT be created with an unapproved template — the
// approved-template requirement is enforced here and re-checked per send by the gate.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('comm_campaigns').select('*').is('archived_at', null).order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ campaigns: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CampaignCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid campaign', details: v.error.flatten() }, { status: 400 })
  if (!v.data.quiet_hours_ack) return NextResponse.json({ error: 'You must confirm consent + quiet-hours before creating a campaign.', reason: 'quiet_hours_ack' }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // Enforce: only an APPROVED template can be attached (unapproved is unusable).
    const { data: tpl } = await db.from('comm_templates').select('id, approval_status, channel, archived_at').eq('id', v.data.template_id).maybeSingle()
    if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    if (tpl.approval_status !== 'approved' || tpl.archived_at) {
      return NextResponse.json({ error: 'Template is not approved. Only approved templates can be used by a campaign.', reason: 'unapproved_template' }, { status: 422 })
    }
    if (tpl.channel !== v.data.channel) return NextResponse.json({ error: 'Template channel does not match campaign channel.' }, { status: 400 })

    // A/B variants: every variant template must exist, be approved, and match channel.
    if (v.data.ab_enabled && v.data.variants.length > 0) {
      for (const variant of v.data.variants) {
        const { data: vt } = await db.from('comm_templates').select('id, approval_status, channel, archived_at').eq('id', variant.template_id).maybeSingle()
        if (!vt) return NextResponse.json({ error: `Variant "${variant.key}" template not found.` }, { status: 404 })
        if (vt.approval_status !== 'approved' || vt.archived_at) return NextResponse.json({ error: `Variant "${variant.key}" template is not approved.`, reason: 'unapproved_template' }, { status: 422 })
        if (vt.channel !== v.data.channel) return NextResponse.json({ error: `Variant "${variant.key}" template channel mismatch.` }, { status: 400 })
      }
    }

    // Drip campaigns require an attached sequence.
    if (v.data.type === 'drip' && !v.data.sequence_id) {
      return NextResponse.json({ error: 'A drip campaign requires a sequence.', reason: 'missing_sequence' }, { status: 400 })
    }

    // Slice 7 (§7) — a delegated campaign: the delegation + represented owner must exist AND
    // belong to the SAME agency. The delegation's ACTIVE/in-scope status is re-checked FRESH
    // at send time by the gate; here we only verify the config is internally consistent so a
    // mismatched pairing can't be stored. (Zod already enforces the two fields set together.)
    if (v.data.delegation_id && v.data.represented_agency_owner_id) {
      const [{ data: del }, { data: owner }] = await Promise.all([
        db.from('agency_communication_delegations').select('id, agency_id').eq('id', v.data.delegation_id).maybeSingle(),
        db.from('agency_owners').select('id, agency_id').eq('id', v.data.represented_agency_owner_id).maybeSingle(),
      ])
      if (!del) return NextResponse.json({ error: 'Delegation not found.', reason: 'delegation_not_found' }, { status: 404 })
      if (!owner) return NextResponse.json({ error: 'Represented agency owner not found.', reason: 'owner_not_found' }, { status: 404 })
      if (del.agency_id !== owner.agency_id) {
        return NextResponse.json({ error: 'The delegation and the represented owner belong to different agencies.', reason: 'delegation_agency_mismatch' }, { status: 422 })
      }
    }

    const { data, error } = await db
      .from('comm_campaigns')
      .insert({
        name: v.data.name,
        channel: v.data.channel,
        category: v.data.category,
        template_id: v.data.template_id,
        type: v.data.type,
        subject: v.data.subject ?? null,
        sequence_id: v.data.sequence_id ?? null,
        ab_enabled: v.data.ab_enabled,
        variants: v.data.ab_enabled ? v.data.variants : [],
        audience: v.data.audience,
        schedule_at: v.data.schedule_at ? new Date(v.data.schedule_at).toISOString() : null,
        quiet_hours_ack: true,
        status: 'draft',
        // Slice 7 builder config (§9/§10, §7).
        purpose: v.data.purpose ?? null,
        represented_agency_owner_id: v.data.represented_agency_owner_id ?? null,
        delegation_id: v.data.delegation_id ?? null,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'comm_campaign', entityId: data.id, diff: { name: data.name, template_id: v.data.template_id } })
    return NextResponse.json({ campaign: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}
