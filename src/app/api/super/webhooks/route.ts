import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { WebhookCreateSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// P-2 Super — outbound webhooks. POST signed event payloads to a target URL.
// Secrets are write-only (never returned in listings).
export async function GET() {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('webhooks')
      .select('id, name, target_url, events, enabled, created_at, updated_at')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ webhooks: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WebhookCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('webhooks')
      .insert({
        name: v.data.name,
        target_url: v.data.target_url,
        events: v.data.events,
        secret: v.data.secret ?? null,
        enabled: true,
        created_by: actor,
      })
      .select('id, name, target_url, events, enabled, created_at, updated_at')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    await writeAudit({ actor, action: 'config.changed', entity: 'webhook', entityId: data.id, diff: { name: data.name, events: data.events } })
    return NextResponse.json({ webhook: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
