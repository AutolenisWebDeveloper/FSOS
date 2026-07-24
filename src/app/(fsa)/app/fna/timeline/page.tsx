import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ReviewRow {
  household_id: string
  type: string
  scheduled_at: string | null
  households: { primary_name: string } | { primary_name: string }[] | null
}
interface PolicyRow {
  household_id: string
  policy_number: string | null
  conversion_deadline: string | null
  renewal_date: string | null
  households: { primary_name: string } | { primary_name: string }[] | null
}

interface Milestone {
  date: string
  kind: string
  label: string
  household: string
  householdId: string
}

function hhName(h: { primary_name: string } | { primary_name: string }[] | null | undefined): string {
  const v = Array.isArray(h) ? h[0] : h
  return v?.primary_name ?? 'Household'
}

// Milestone timeline (build instruction §8). Upcoming planning milestones derived
// from real data — reviews due, policy conversion windows, and renewals. Retirement /
// college / RMD milestones join as plan inputs capture them. Roles: fsa.
export default async function FnaTimelinePage() {
  await requireRole('fsa', '/app/fna/timeline')

  const [reviews, policies] = await Promise.all([
    load<ReviewRow[]>(
      (db) => db.from('reviews').select('household_id, type, scheduled_at, households(primary_name)').not('scheduled_at', 'is', null).order('scheduled_at', { ascending: true }).limit(100),
      [],
    ),
    load<PolicyRow[]>(
      (db) => db.from('household_policies').select('household_id, policy_number, conversion_deadline, renewal_date, households(primary_name)').is('deleted_at', null).limit(300),
      [],
    ),
  ])

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Timeline' }]

  if (!reviews.ok) {
    return (
      <ListShell title="Timeline" breadcrumb={breadcrumb}>
        {reviews.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={reviews.message} />}
      </ListShell>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const milestones: Milestone[] = []
  for (const r of reviews.data) {
    if (r.scheduled_at) milestones.push({ date: r.scheduled_at.slice(0, 10), kind: 'review', label: `${r.type.replace(/_/g, ' ')} review due`, household: hhName(r.households), householdId: r.household_id })
  }
  for (const p of policies.ok ? policies.data : []) {
    if (p.conversion_deadline) milestones.push({ date: p.conversion_deadline.slice(0, 10), kind: 'conversion', label: `Term conversion window closes${p.policy_number ? ` (${p.policy_number})` : ''}`, household: hhName(p.households), householdId: p.household_id })
    if (p.renewal_date) milestones.push({ date: p.renewal_date.slice(0, 10), kind: 'renewal', label: `Policy renewal${p.policy_number ? ` (${p.policy_number})` : ''}`, household: hhName(p.households), householdId: p.household_id })
  }
  const upcoming = milestones.filter((m) => m.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 60)

  const TONE: Record<string, 'draft' | 'active' | 'outline'> = { conversion: 'draft', review: 'active', renewal: 'outline' }

  return (
    <ListShell
      title="Milestones"
      description="Upcoming planning milestones — reviews due, term-conversion windows, and policy renewals across households."
      breadcrumb={breadcrumb}
    >
      {upcoming.length === 0 ? (
        <EmptyState title="No upcoming milestones" description="Scheduled reviews and policy conversion/renewal dates appear here as they are captured." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {upcoming.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.label}</p>
                    <Link href={`/app/households/${m.householdId}`} className="text-xs text-primary hover:underline">{m.household}</Link>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={TONE[m.kind] ?? 'outline'}>{m.kind}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(m.date).toLocaleDateString('en-US')}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </ListShell>
  )
}
