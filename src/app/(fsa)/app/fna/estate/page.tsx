import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface HouseholdRow {
  id: string
  primary_name: string
  household_members: { id: string; relationship: string | null }[] | null
}

// Estate & beneficiary discovery (build instruction §8). A discovery view over
// household composition — the surface that drives survivor analysis and
// beneficiary review. Beneficiary capture + mismatch detection deepen as the
// estate model lands; this prompts the review from what FSOS knows. Roles: fsa.
export default async function FnaEstatePage() {
  await requireRole('fsa', '/app/fna/estate')

  const res = await load<HouseholdRow[]>(
    (db) => db.from('households').select('id, primary_name, household_members(id, relationship)').is('deleted_at', null).order('primary_name', { ascending: true }).limit(100),
    [],
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Estate' }]

  if (!res.ok) {
    return (
      <ListShell title="Estate & beneficiary" breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </ListShell>
    )
  }

  return (
    <ListShell
      title="Estate & beneficiary"
      description="Discovery across households — composition drives survivor analysis and the beneficiary review. Analysis only; the licensed FSA authors recommendations."
      breadcrumb={breadcrumb}
    >
      {res.data.length === 0 ? (
        <EmptyState
          title="No households yet"
          description="Add a household from a referral to begin estate & beneficiary discovery."
          action={
            <Button asChild>
              <Link href="/app/fna/plans">View plans</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.map((h) => {
            const members = h.household_members ?? []
            const dependents = members.filter((m) => (m.relationship ?? '').toLowerCase().match(/child|depend|son|daughter/)).length
            return (
              <Card key={h.id}>
                <CardContent className="space-y-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/app/households/${h.id}`} className="truncate font-medium text-primary hover:underline">
                      {h.primary_name}
                    </Link>
                    <Badge variant="outline">{members.length} member{members.length === 1 ? '' : 's'}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {dependents > 0 ? `${dependents} dependent(s) · ` : ''}Beneficiary review recommended — confirm designations align with the estate plan.
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </ListShell>
  )
}
