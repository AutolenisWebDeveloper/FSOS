import Link from 'next/link'
import { ListShell, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-6 Products. is_security propagates the firewall; conversion_window is an assumption default.
export default async function SuperProductsPage() {
  const rows = await load<{ id: string; family: string; subtype: string | null; is_security: boolean; required_license: string | null; conversion_window_days: number | null; conversion_window_is_assumption: boolean; active: boolean }[]>(
    (db) => db.from('products').select('*').order('family'),
    [],
  )
  return (
    <ListShell title="Products" description="Setting is_security on a product propagates the firewall to every opportunity/case using it." breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Products' }]}>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No products configured" description="Opportunity/case creation is blocked until a product catalog exists." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>Family</TableHead><TableHead>Subtype</TableHead><TableHead>Securities</TableHead><TableHead>Required license</TableHead><TableHead>Conversion window</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((p) => (<TableRow key={p.id} className={p.is_security ? securitiesRowClass : undefined}><TableCell><Link href={`/super/products/${p.id}`} className="font-medium capitalize text-primary hover:underline">{p.family}</Link></TableCell><TableCell className="text-muted-foreground">{p.subtype ?? '—'}</TableCell><TableCell>{p.is_security ? <SecuritiesChip /> : <Badge variant="outline">no</Badge>}</TableCell><TableCell className="text-muted-foreground">{p.required_license ?? '—'}</TableCell><TableCell>{p.conversion_window_days ? <span className="flex items-center gap-2">{p.conversion_window_days}d {p.conversion_window_is_assumption ? <AssumptionBadge /> : null}</span> : '—'}</TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
