import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric, Money } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// OS-11 Chargebacks (A2). Clawbacks against placed business (negative adjustments).
export default async function ChargebacksPage() {
  const rows = await load<{ id: string; commission_id: string; amount: number; reason: string; actor: string | null; created_at: string }[]>(
    (db) => db.from('commission_adjustments').select('*').eq('kind', 'chargeback').order('created_at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Chargebacks" description="Clawbacks against placed business. Every one carries a reason + audit." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: 'Chargebacks' }]}>
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No chargebacks" description="Clawbacks appear here when recorded against a commission." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Commission</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground"><Numeric>{new Date(r.created_at).toLocaleDateString('en-US')}</Numeric></TableCell>
                  <TableCell className="text-right"><Badge variant="lost"><Money value={r.amount} /></Badge></TableCell>
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
