// src/lib/data/commissions.ts
// Shared server-side loader: commission rows joined to agency names, for the
// expected/received/pending/discrepancy list pages. Keeps the query in one place.
import { load } from '@/lib/data/query'
import type { CommissionRow } from '@/components/app/CommissionList'

interface RawCommission {
  id: string
  referring_agency_id: string | null
  product_family: string | null
  is_security: boolean
  total_commission: number
  fsa_amount: number
  agency_amount: number
  received_amount: number
  is_trail: boolean
  paid_on: string | null
  reconciliation_status: string
}

export interface CommissionFilter {
  status?: string
  trailOnly?: boolean
}

export async function loadCommissions(
  f: CommissionFilter = {},
): Promise<{ ok: false; message: string; notConfigured: boolean } | { ok: true; rows: CommissionRow[] }> {
  const [comms, agencies] = await Promise.all([
    load<RawCommission[]>((db) => {
      let q = db
        .from('commissions')
        .select('id, referring_agency_id, product_family, is_security, total_commission, fsa_amount, agency_amount, received_amount, is_trail, paid_on, reconciliation_status')
        .order('created_at', { ascending: false })
      if (f.status) q = q.eq('reconciliation_status', f.status)
      if (f.trailOnly) q = q.eq('is_trail', true)
      return q
    }, []),
    load<{ id: string; agency_name: string }[]>((db) => db.from('agency_partnerships').select('id, agency_name'), []),
  ])
  if (!comms.ok) return { ok: false, message: comms.message, notConfigured: comms.kind === 'not_configured' }
  const agencyMap = new Map((agencies.ok ? agencies.data : []).map((a) => [a.id, a.agency_name]))
  const rows: CommissionRow[] = comms.data.map((c) => ({
    id: c.id,
    agency_name: c.referring_agency_id ? agencyMap.get(c.referring_agency_id) ?? null : null,
    product_family: c.product_family,
    is_security: c.is_security,
    total_commission: Number(c.total_commission ?? 0),
    fsa_amount: Number(c.fsa_amount ?? 0),
    agency_amount: Number(c.agency_amount ?? 0),
    received_amount: Number(c.received_amount ?? 0),
    is_trail: c.is_trail,
    paid_on: c.paid_on,
    reconciliation_status: c.reconciliation_status,
  }))
  return { ok: true, rows }
}
