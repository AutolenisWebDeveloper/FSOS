import Link from 'next/link'
import { ListShell, StatTile } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/ui/typography'
import { loadBookAnalytics } from '@/lib/analytics/reports'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REPORTS = [
  { id: 'book-analytics', name: 'Book analytics', desc: 'Live headline totals + pipeline, lead-source, case-status, activity, and commission-by-month.' },
  { id: 'pipeline', name: 'Pipeline by engagement', desc: 'Opportunities and premium by engagement model and stage.' },
  { id: 'commission-by-agency', name: 'Commission by agency', desc: 'Attributed commission per agency partnership.' },
  { id: 'conversion', name: 'Term conversion', desc: 'Windows entered, invited, scheduled.' },
  { id: 'cross-sell', name: 'Cross-sell', desc: 'Coverage gaps and agency penetration.' },
  { id: 'production', name: 'Production', desc: 'Placements and premium over the period.' },
]

// Reporting library. Each report renders from a DB-derived view/query (no drift).
// The headline strip is live (App B rebuild of App A's Reports dashboard totals).
export default async function ReportsPage() {
  const res = await loadBookAnalytics()
  const t = res.ok ? res.data.totals : null

  return (
    <ListShell
      title="Reports"
      description="The reporting library. Every report is derived from the data — export CSV/PDF from a report view."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Reports' }]}
    >
      {t ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Households" value={t.households} href="/app/households" />
          <StatTile label="Policies" value={t.policies} href="/app/policies" />
          <StatTile label="Open cases" value={t.open_cases} href="/app/cases" />
          <StatTile label="FSA commission" value={<Money value={t.fsa_commission} />} href="/app/reports/book-analytics" hint="Received / matched" />
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.id} href={`/app/reports/${r.id}`}>
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardHeader>
                <CardTitle className="text-base">{r.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{r.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </ListShell>
  )
}
