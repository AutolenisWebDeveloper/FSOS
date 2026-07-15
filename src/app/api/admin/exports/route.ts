import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { DataExportSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// P-2 Admin data exports. Data ownership / portability endpoint.
// NOTE: actual file generation runs as a background job (Vercel Cron): this
// endpoint ONLY enqueues the request (status 'requested'). An independent
// pg_dump / CSV export worker later fulfils it, writing file_ref + status
// 'ready' — supporting the FSA's data portability and ownership. Securities
// substantive data is never exported (firewall §2.1).

type ExportRow = {
  id: string
  dataset: string
  format: string
  status: string
  row_count: number | null
  file_ref: string | null
  notes: string | null
  requested_by: string | null
  requested_at: string
  completed_at: string | null
  expires_at: string | null
}

export async function GET() {
  const auth = await requireApiRole('admin')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data, error } = await db
      .from('data_exports')
      .select('id, dataset, format, status, row_count, file_ref, notes, requested_by, requested_at, completed_at, expires_at')
      .order('requested_at', { ascending: false })
      .limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ exports: (data ?? []) as ExportRow[] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('admin')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['admin', 'ops', 'case_manager', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = DataExportSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
    const { data, error } = await db
      .from('data_exports')
      .insert({
        dataset: v.data.dataset,
        format: v.data.format,
        notes: v.data.notes ?? null,
        status: 'requested',
        requested_by: actor,
        expires_at: expiresAt,
      })
      .select('id, dataset, format, status, row_count, file_ref, notes, requested_by, requested_at, completed_at, expires_at')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'data_export',
      entityId: data.id,
      diff: { dataset: v.data.dataset, format: v.data.format },
    })
    return NextResponse.json({ export: data as ExportRow }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
