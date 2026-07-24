import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PlanRow {
  id: string
  status: string
  title: string | null
  updated_at: string
  households: { primary_name: string } | { primary_name: string }[] | null
}

// Business-owner planning module (build instruction §8). Same engine + data model
// as Comprehensive with a business-owner lens (config plan type
// business_owner_review). Roles: fsa.
export default async function FnaBusinessOwnerPage() {
  await requireRole('fsa', '/app/fna/business-owner')

  const res = await load<PlanRow[]>(
    (db) => db.from('fna_plans').select('id, status, title, updated_at, households(primary_name)').eq('plan_type', 'business_owner_review').is('deleted_at', null).order('updated_at', { ascending: false }),
    [],
  )

  const header = (
    <PageHeader
      title="Business Owner planning"
      description="Comprehensive planning with a business-owner lens — protection, retirement, and succession discovery. Pick “Business Owner Review” when starting a plan."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Business owner' }]}
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
      {res.data.length === 0 ? (
        <EmptyState title="No business-owner plans yet" description="Start a plan and choose “Business Owner Review” to run comprehensive planning with a business lens." />
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
