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
