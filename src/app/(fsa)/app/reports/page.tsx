import Link from 'next/link'
import { ListShell } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

const REPORTS = [
  { id: 'pipeline', name: 'Pipeline by engagement', desc: 'Opportunities and premium by engagement model and stage.' },
  { id: 'commission-by-agency', name: 'Commission by agency', desc: 'Attributed commission per agency partnership.' },
  { id: 'conversion', name: 'Term conversion', desc: 'Windows entered, invited, scheduled.' },
  { id: 'cross-sell', name: 'Cross-sell', desc: 'Coverage gaps and agency penetration.' },
  { id: 'production', name: 'Production', desc: 'Placements and premium over the period.' },
]

// Reporting library. Each report renders from a DB-derived view (no drift).
export default function ReportsPage() {
  return (
    <ListShell title="Reports" description="The reporting library. Every report is derived from the data — export CSV/PDF from a report view." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Reports' }]}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.id} href={`/app/reports/${r.id}`}>
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardHeader><CardTitle className="text-base">{r.name}</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{r.desc}</p></CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </ListShell>
  )
}
