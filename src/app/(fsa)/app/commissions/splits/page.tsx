import { SettingsShell, SettingsSection, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { SplitConfigForm } from '@/components/app/CommissionControls'

export const dynamic = 'force-dynamic'

// OS-11 Split Configuration (A10). Every default renders the "config default — verify"
// note. No split value is presented as authoritative.
export default async function SplitsPage() {
  const [splits, agencies] = await Promise.all([
    load<{ id: string; product_family: string; agency_id: string | null; fsa_split_pct: number; agency_split_pct: number; is_assumption: boolean; note: string | null }[]>(
      (db) => db.from('commission_splits').select('*').order('product_family'),
      [],
    ),
    load<{ id: string; agency_name: string }[]>((db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null).order('agency_name'), []),
  ])
  const agencyMap = new Map((agencies.ok ? agencies.data : []).map((a) => [a.id, a.agency_name]))

  return (
    <SettingsShell title="Commission Splits" description="FSA ↔ agency split defaults. Labeled config — never a Farmers-published figure.">
      <SettingsSection title="Configured splits" description="Per-agency overrides supersede the default. Percentages must sum to 100.">
        {!splits.ok ? (
          <ErrorState description={splits.kind === 'not_configured' ? 'Database not configured.' : splits.message} />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader><TableRow><TableHead>Family</TableHead><TableHead>Scope</TableHead><TableHead className="text-right">FSA %</TableHead><TableHead className="text-right">Agency %</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {splits.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="capitalize font-medium">{s.product_family}</TableCell>
                    <TableCell className="text-muted-foreground">{s.agency_id ? agencyMap.get(s.agency_id) ?? 'agency override' : 'default'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.fsa_split_pct}%</TableCell>
                    <TableCell className="text-right tabular-nums">{s.agency_split_pct}%</TableCell>
                    <TableCell>{s.is_assumption ? <AssumptionBadge /> : <Badge variant="active">confirmed</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">config default — verify with contract; not a Farmers-published figure.</p>
      </SettingsSection>
      <SettingsSection title="Add / update a split" description="Set a default or a per-agency override.">
        <SplitConfigForm agencies={agencies.ok ? agencies.data : []} />
      </SettingsSection>
    </SettingsShell>
  )
}
