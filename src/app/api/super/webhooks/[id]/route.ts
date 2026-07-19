import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { WebhookPatchSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// P-2 Super — enable/disable an outbound webhook.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WebhookPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('webhooks')
      .update({ enabled: v.data.enabled, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select('id, name, target_url, events, enabled, created_at, updated_at')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })

    await writeAudit({ actor, action: 'config.changed', entity: 'webhook', entityId: params.id, diff: { enabled: v.data.enabled } })
    return NextResponse.json({ webhook: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
