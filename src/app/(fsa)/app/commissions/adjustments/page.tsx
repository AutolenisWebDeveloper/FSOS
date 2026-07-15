import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-11 Adjustments (A2). Manual corrections — reason required + diffed in audit.
export default async function AdjustmentsPage() {
  const rows = await load<{ id: string; commission_id: string; amount: number; kind: string; reason: string; created_at: string }[]>(
    (db) => db.from('commission_adjustments').select('*').order('created_at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Adjustments" description="Manual corrections. Each requires a reason and is diffed in the audit log." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: 'Adjustments' }]}>
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No adjustments" description="Manual corrections appear here." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Kind</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Commission</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString('en-US')}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{r.kind}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">${Number(r.amount).toLocaleString('en-US')}</TableCell>
                  <TableCell>{r.reason}</TableCell>
                  <TableCell className="text-right"><Link href={`/app/commissions/${r.commission_id}`} className="text-primary hover:underline">Open</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
