import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Identity-disclosure config (Slice 2, §8). The approved, editable Farmers disclosure
// wording that the platform auto-inserts on first contact. Editing bumps the version and
// resets approval (re-approval required); approving enables auto-insertion. Nothing is
// auto-disclosed with unverified wording until the config is explicitly approved.

const SaveSchema = z.object({
  action: z.literal('save'),
  fsaRoleLabel: z.string().trim().min(3).max(200),
  fullTemplate: z.string().trim().min(20).max(2000),
  abbreviatedTemplate: z.string().trim().min(10).max(1000),
  inactivityDays: z.number().int().min(1).max(3650),
  markVerified: z.boolean().optional(),
})
const ApproveSchema = z.object({ action: z.literal('approve') })
const BodySchema = z.discriminatedUnion('action', [SaveSchema, ApproveSchema])

// The route uses the service-role DB client (bypasses RLS), so it enforces the role
// allowlist itself — the SAME allowlist as comms/templates management (fsa /
// licensed_staff / super_admin). requireApiRole('fsa') already rejects other portals,
// so the allowlist is kept honest (no compliance/admin here — they can never reach it).
const MANAGE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...MANAGE_ROLES])
  if (denied) return denied
  try {
    const { data, error } = await getDb().from('comm_identity_config').select('*').eq('id', 'global').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ config: data ?? null })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  // Managing the disclosure wording + approval is a licensed back-office action, gated to
  // the same roles as template management (the FSA portal admits only these).
  const denied = requirePermission(auth.session, [...MANAGE_ROLES])
  if (denied) return denied

  const parsed = await readJson<unknown>(req)
  if ('error' in parsed) return parsed.error
  const body = BodySchema.safeParse(parsed.data)
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request', details: body.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    if (body.data.action === 'approve') {
      const { data: cfg } = await db
        .from('comm_identity_config')
        .select('fsa_role_label, full_template, abbreviated_template')
        .eq('id', 'global')
        .maybeSingle()
      if (!cfg?.fsa_role_label || !cfg?.full_template || !cfg?.abbreviated_template) {
        return NextResponse.json({ error: 'Cannot approve — the disclosure wording is incomplete.' }, { status: 422 })
      }
      const { error } = await db
        .from('comm_identity_config')
        .update({ approval_status: 'approved', approved_at: new Date().toISOString(), approved_by: actor, updated_at: new Date().toISOString() })
        .eq('id', 'global')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await writeAudit({ actor, action: 'approval.decided', entity: 'comm_identity_config', entityId: 'global', diff: { approval_status: 'approved' } })
      return NextResponse.json({ ok: true, approval_status: 'approved' })
    }

    // save — editing wording bumps the version and resets approval (re-approval required),
    // so a changed disclosure can never auto-send before it is re-approved.
    const { data: current } = await db.from('comm_identity_config').select('version').eq('id', 'global').maybeSingle()
    const nextVersion = (current?.version ?? 0) + 1
    const patch: Record<string, unknown> = {
      fsa_role_label: body.data.fsaRoleLabel,
      full_template: body.data.fullTemplate,
      abbreviated_template: body.data.abbreviatedTemplate,
      inactivity_days: body.data.inactivityDays,
      version: nextVersion,
      approval_status: 'draft',
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
    }
    // Editing the wording is the FSA asserting their real terms → clear the assumption
    // badge only when they explicitly mark it verified.
    if (body.data.markVerified) patch.is_assumption = false
    const { error } = await db.from('comm_identity_config').update(patch).eq('id', 'global')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'config.changed', entity: 'comm_identity_config', entityId: 'global', diff: { version: nextVersion, approval_status: 'draft' } })
    return NextResponse.json({ ok: true, version: nextVersion, approval_status: 'draft' })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
