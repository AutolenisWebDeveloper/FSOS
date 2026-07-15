import { redirect } from 'next/navigation'
import { ReportShell, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Money } from '@/components/ui/typography'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { agencyIdsFor, compDisclosureEnabled } from '@/lib/portal/scope'

export const dynamic = 'force-dynamic'

// P-4 Attributed Commissions (A2). Permission-gated: rendered ONLY where config
// permits comp disclosure to the owner. If disclosure is off → 403 (nav also hidden).
// Only the AGENCY share is ever shown — never the FSA amount (column-projected).
export default async function PartnerCommissionsPage() {
  const session = await getServerSession()
  const agencyIds = session ? await agencyIdsFor(session) : []
  const allowed = await compDisclosureEnabled(agencyIds)
  if (!allowed) redirect('/403') // comp disclosure off → not reachable

  let rows: { agency_amount: number; product_family: string | null; total_commission: number }[] = []
  let err: string | null = null
  try {
    // v_commission_by_agency exposes agency_amount; we never select fsa_amount here.
    const { data } = await getDb().from('v_commission_by_agency').select('agency_name, product_family, agency_amount, total_commission').in('referring_agency_id', agencyIds)
    rows = (data ?? []) as typeof rows
  } catch (e) { err = e instanceof Error ? e.message : 'Failed' }

  return (
    <ReportShell title="Attributed Commissions" description="Your agency's attributed split. Config defaults where not contract-confirmed." actions={<AssumptionBadge />}>
      {err ? <ErrorState description={err} /> : rows.length === 0 ? <EmptyState title="No attributed commissions" description="Attributed splits appear here after placements." /> : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Family</TableHead><TableHead className="text-right">Your attributed share</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}><TableCell className="capitalize">{r.product_family ?? '—'}</TableCell><TableCell className="text-right tabular-nums"><Money value={Number(r.agency_amount)} /></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">config default — verify with contract; not a Farmers-published figure.</p>
    </ReportShell>
  )
}
