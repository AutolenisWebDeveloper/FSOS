import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { CommissionReceiptSchema, CommissionAdjustmentSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('commissions').select('*').eq('id', params.id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ commission: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Record a received amount (dedupe on policy/period/amount) or a manual adjustment
// (reason required; diffed). Body: { op: 'receipt' | 'adjustment', ... }.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<{ op?: string }>(req)
  if ('error' in parsed) return parsed.error
  const op = parsed.data.op
  const db = getDb()
  const actor = actorOf(auth.session)

  try {
    const { data: commission } = await db.from('commissions').select('*').eq('id', params.id).maybeSingle()
    if (!commission) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (op === 'receipt') {
      const v = CommissionReceiptSchema.safeParse({ ...parsed.data, commission_id: params.id })
      if (!v.success) return NextResponse.json({ error: 'Invalid receipt', details: v.error.flatten() }, { status: 400 })
      // Dedupe on commission/period/amount (WF-7): idempotent receipt recording.
      const dedupe = `${params.id}:${v.data.period ?? ''}:${v.data.amount}`
      const { data: existing } = await db.from('commission_receipts').select('id').eq('dedupe_key', dedupe).maybeSingle()
      if (existing) return NextResponse.json({ ok: true, idempotent: true })
      await db.from('commission_receipts').insert({ commission_id: params.id, amount: v.data.amount, period: v.data.period ?? null, paid_on: v.data.paid_on ?? null, is_trail: v.data.is_trail, dedupe_key: dedupe, source: 'manual' })
      const received = Number(commission.received_amount ?? 0) + v.data.amount
      const status = received >= Number(commission.total_commission ?? 0) ? 'matched' : 'received'
      await db.from('commissions').update({ received_amount: received, reconciliation_status: status, paid_on: v.data.paid_on ?? commission.paid_on, updated_at: new Date().toISOString() }).eq('id', params.id)
      await writeAudit({ actor, action: 'entity.updated', entity: 'commission', entityId: params.id, diff: { received_amount: received, reconciliation_status: status } })
      return NextResponse.json({ ok: true, received_amount: received, reconciliation_status: status })
    }

    if (op === 'adjustment') {
      const v = CommissionAdjustmentSchema.safeParse({ ...parsed.data, commission_id: params.id })
      if (!v.success) return NextResponse.json({ error: 'Invalid adjustment', details: v.error.flatten() }, { status: 400 })
      await db.from('commission_adjustments').insert({ commission_id: params.id, amount: v.data.amount, kind: v.data.kind, reason: v.data.reason, actor })
      const newTotal = Number(commission.total_commission ?? 0) + v.data.amount
      await db.from('commissions').update({ total_commission: newTotal, updated_at: new Date().toISOString() }).eq('id', params.id)
      await writeAudit({ actor, action: 'entity.updated', entity: 'commission', entityId: params.id, diff: { adjustment: v.data.amount, kind: v.data.kind, reason: v.data.reason, before_total: commission.total_commission, after_total: newTotal } })
      return NextResponse.json({ ok: true, total_commission: newTotal })
    }

    return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
