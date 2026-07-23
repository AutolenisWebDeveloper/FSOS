import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// FNA Assumption Manager (ADR-016, build instruction §8 routes — slice 1–2). A
// read view over the versioned, editable fna_assumption_sets store: values,
// sources, effective dates, and versions. Every value is a labeled ASSUMPTION
// ("config default — verify", CLAUDE.md §4.3) — never a Farmers/FFS-published
// fact — so each renders the gold assumption badge. Editing lands in a later slice;
// this surfaces the structured store the engine (ADR-015) consumes. Roles: fsa.

interface AssumptionRow {
  key: string
  value: number
  unit: string
  source: string
  effective_date: string
  is_assumption: boolean
}
interface AssumptionSetRow {
  id: string
  version: string
  label: string
  scope: string
  is_active: boolean
  updated_at: string
  assumptions: AssumptionRow[]
}

/** Human-format a value by its unit (rate→%, usd→$, years/months, pct). */
function formatValue(v: number, unit: string): string {
  switch (unit) {
    case 'rate':
      return `${(v * 100).toFixed(2)}%`
    case 'pct':
      return `${v}%`
    case 'years':
      return `${v} yrs`
    case 'months':
      return `${v} mo`
    case 'usd':
      return `$${v.toLocaleString('en-US')}`
    default:
      return String(v)
  }
}

export default async function FnaAssumptionsPage() {
  await requireRole('fsa', '/app/fna/assumptions')

  const res = await load<AssumptionSetRow[]>(
    (db) =>
      db
        .from('fna_assumption_sets')
        .select('id, version, label, scope, is_active, updated_at, assumptions')
        .order('scope', { ascending: true })
        .order('updated_at', { ascending: false }),
    [],
  )

  const header = (
    <PageHeader
      title="Planning Assumptions"
      description="Versioned, editable assumption sets the calculation engine uses. Every value is a config default to verify — not a Farmers or FFS published figure."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Assumptions' }]}
    />
  )

  if (!res.ok) {
    return (
      <div className="space-y-6">
        {header}
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      {res.data.length === 0 ? (
        <EmptyState
          title="No assumption sets yet"
          description="The default assumption set is seeded by the FNA data-model migration (052). If none appears, apply it."
        />
      ) : (
        <div className="space-y-6">
          {res.data.map((set) => (
            <Card key={set.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{set.label}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Version <span className="font-mono">{set.version}</span> · {set.scope} scope · updated{' '}
                    {new Date(set.updated_at).toLocaleDateString('en-US')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {set.is_active ? <Badge variant="active">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                  <Badge variant="assumption">Config default — verify</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th scope="col" className="py-2 pr-4 font-medium">Assumption</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Value</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Source</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Effective</th>
                        <th scope="col" className="py-2 font-medium">Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {set.assumptions.map((a) => (
                        <tr key={a.key} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium">{a.key.replace(/_/g, ' ')}</td>
                          <td className="py-2 pr-4 font-mono tabular-nums">{formatValue(a.value, a.unit)}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{a.source}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{a.effective_date}</td>
                          <td className="py-2">
                            {a.is_assumption ? <Badge variant="assumption">Assumption</Badge> : <Badge variant="outline">Fixed</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
