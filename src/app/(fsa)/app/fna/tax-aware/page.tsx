import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DEFAULT_ASSUMPTIONS } from '@/lib/fna/engine'
import { fmtPercent } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PlanRow {
  id: string
  status: string
  title: string | null
  households: { primary_name: string } | { primary_name: string }[] | null
}

// Tax-aware planning module (build instruction §8). Tax treatment is a stored,
// LABELED assumption (effective_tax_rate) — this surfaces it. ASSUMPTIONS ONLY,
// never tax advice. Roles: fsa.
export default async function FnaTaxAwarePage() {
  await requireRole('fsa', '/app/fna/tax-aware')

  const taxRate = DEFAULT_ASSUMPTIONS.assumptions.find((a) => a.key === 'effective_tax_rate')?.value ?? 0

  const res = await load<PlanRow[]>(
    (db) => db.from('fna_plans').select('id, status, title, households(primary_name)').eq('plan_type', 'tax_aware_review').is('deleted_at', null).order('updated_at', { ascending: false }),
    [],
  )

  const header = (
    <PageHeader
      title="Tax-aware planning"
      description="Comprehensive planning that surfaces the tax-treatment assumption. Pick “Tax-Aware Planning Review” when starting a plan."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Tax-aware' }]}
      actions={
        <Button asChild>
          <Link href="/app/fna/plans/new">Start a plan</Link>
        </Button>
      }
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

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-status-assumption/40 bg-status-assumption/10 p-4 text-sm">
        <Badge variant="assumption">Assumption</Badge>
        <span>
          Effective tax rate: <span className="font-mono font-semibold">{fmtPercent(taxRate, 1)}</span> — a config default to verify.
        </span>
        <Link href="/app/fna/assumptions" className="text-xs text-primary hover:underline">Manage assumptions</Link>
        <p className="w-full text-xs text-muted-foreground">This module applies a tax-treatment assumption. It is not tax advice — the licensed FSA and a tax professional own any tax conclusion.</p>
      </div>

      {res.data.length === 0 ? (
        <EmptyState title="No tax-aware plans yet" description="Start a plan and choose “Tax-Aware Planning Review” to run planning with the tax-treatment assumption surfaced." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {res.data.map((p) => {
                const hh = Array.isArray(p.households) ? p.households[0] : p.households
                return (
                  <li key={p.id}>
                    <Link href={`/app/fna/plans/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                      <p className="truncate font-medium">{p.title || hh?.primary_name || 'Plan'}</p>
                      <Badge variant={p.status === 'APPROVED' ? 'active' : 'outline'}>{p.status.replace(/_/g, ' ')}</Badge>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
