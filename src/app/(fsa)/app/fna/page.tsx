import Link from 'next/link'
import { FileSignature, ListChecks, Wallet, ShieldCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState, StatTile, Section } from '@/components/archetypes'
import { load, unwrapOne } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { planTypeDef } from '@/lib/fna/plan-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI FNA Command Center — Overview (build instruction §8). The landing page is no
// longer the generator: it is the planning workspace's home — household reach,
// planning status, and a running list of plans. The narrative generator lives on
// as one action (/app/fna/generate); the structured plan flow is the new spine.
// Roles: fsa, licensed_staff.
interface PlanRow {
  id: string
  plan_type: string
  status: string
  updated_at: string
  households: { primary_name: string } | { primary_name: string }[] | null
}

const STATUS_TONE: Record<string, 'active' | 'draft' | 'outline'> = {
  APPROVED: 'active',
  CALCULATED: 'active',
  UNDER_REVIEW: 'draft',
  IN_PROGRESS: 'draft',
  DRAFT: 'outline',
}

export default async function FnaOverviewPage() {
  await requireRole('fsa', '/app/fna')

  const [households, plans] = await Promise.all([
    load<{ id: string }[]>((db) => db.from('households').select('id').is('deleted_at', null), []),
    load<PlanRow[]>(
      (db) =>
        db
          .from('fna_plans')
          .select('id, plan_type, status, updated_at, households(primary_name)')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(12),
      [],
    ),
  ])

  const header = (
    <PageHeader
      title="AI FNA Command Center"
      description="Structured, deterministic financial planning. Every figure traces to a formula, its version, the inputs, and the assumptions used."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center' }]}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/app/fna/plans/new">Start a plan</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/app/fna/generate">Generate narrative</Link>
          </Button>
        </div>
      }
    />
  )

  if (!households.ok) {
    return (
      <div className="space-y-6">
        {header}
        {households.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={households.message} />}
      </div>
    )
  }
  if (!plans.ok) {
    return (
      <div className="space-y-6">
        {header}
        {plans.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={plans.message} />}
      </div>
    )
  }

  const householdCount = households.data.length
  const planCount = plans.data.length
  const activeCount = plans.data.filter((p) => p.status === 'CALCULATED' || p.status === 'UNDER_REVIEW').length
  const approvedCount = plans.data.filter((p) => p.status === 'APPROVED').length

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Households" value={householdCount} href="/app/households" icon={ListChecks} tone="brand" hint="Book of business" />
        <StatTile label="Recent plans" value={planCount} href="/app/fna/plans" icon={FileSignature} hint="Latest 12" />
        <StatTile label="In progress" value={activeCount} icon={Wallet} tone="attention" hint="Calculated / under review" />
        <StatTile label="Approved" value={approvedCount} icon={ShieldCheck} tone="brand" hint="Presentable to a client" />
      </div>

      <Section title="Planning modules" description="Every analysis and workspace across the command center.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { href: '/app/fna/plans', label: 'Plans' },
            { href: '/app/fna/cash-flow', label: 'Cash flow' },
            { href: '/app/fna/net-worth', label: 'Net worth' },
            { href: '/app/fna/retirement', label: 'Retirement' },
            { href: '/app/fna/education', label: 'Education' },
            { href: '/app/fna/protection', label: 'Protection' },
            { href: '/app/fna/estate', label: 'Estate & beneficiary' },
            { href: '/app/fna/goals', label: 'Goals' },
            { href: '/app/fna/scenarios', label: 'Scenarios' },
            { href: '/app/fna/reviews', label: 'Reviews' },
            { href: '/app/fna/reports', label: 'Reports' },
            { href: '/app/fna/documents', label: 'Documents & data quality' },
            { href: '/app/fna/business-owner', label: 'Business owner' },
            { href: '/app/fna/tax-aware', label: 'Tax-aware' },
            { href: '/app/fna/assumptions', label: 'Assumptions' },
            { href: '/app/fna/recommendations', label: 'Recommendations' },
            { href: '/app/fna/formulas', label: 'Formula explorer' },
            { href: '/app/fna/timeline', label: 'Timeline' },
            { href: '/app/fna/audit', label: 'Cross-plan audit' },
            { href: '/app/fna/generate', label: 'Generate narrative' },
          ].map((m) => (
            <Link key={m.href} href={m.href} className="rounded-md border p-3 text-sm font-medium transition-colors hover:bg-muted/40">
              {m.label}
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Recent plans" description="The latest planning activity across households." action={<Link className="text-sm text-primary hover:underline" href="/app/fna/plans">View all</Link>}>
        {plans.data.length === 0 ? (
          <EmptyState
            title="No plans yet"
            description="Start an Express Financial Checkup or a Comprehensive FNA for a household to begin structured planning."
            action={
              <Button asChild>
                <Link href="/app/fna/plans/new">Start a plan</Link>
              </Button>
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {plans.data.map((p) => {
                  const hh = unwrapOne(p.households)
                  return (
                    <li key={p.id}>
                      <Link href={`/app/fna/plans/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{hh?.primary_name ?? 'Household'}</p>
                          <p className="text-xs text-muted-foreground">{planTypeDef(p.plan_type)?.label ?? p.plan_type}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <Badge variant={STATUS_TONE[p.status] ?? 'outline'}>{p.status.replace(/_/g, ' ')}</Badge>
                          <span className="text-xs text-muted-foreground">{new Date(p.updated_at).toLocaleDateString('en-US')}</span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </Section>
    </div>
  )
}
