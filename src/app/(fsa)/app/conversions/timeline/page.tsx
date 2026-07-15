import Link from 'next/link'
import { ReportShell, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// OS-07 Timeline (A11). Conversion windows laid out by urgency tier.
export default async function ConversionTimelinePage() {
  const rows = await load<{ policy_id: string; household_id: string; primary_name: string; conversion_deadline: string; days_remaining: number; urgency_tier: string; is_security: boolean }[]>(
    (db) => db.from('v_conversions_due').select('*').neq('urgency_tier', 'beyond').order('days_remaining', { ascending: true }).limit(500),
    [],
  )
  const tiers: { key: string; label: string }[] = [
    { key: '30', label: '≤ 30 days — urgent' },
    { key: '90', label: '≤ 90 days' },
    { key: '180', label: '≤ 180 days' },
    { key: '365', label: '≤ 365 days' },
  ]

  return (
    <ReportShell
      title="Conversion Timeline"
      description="Windows entering their conversion period, by urgency."
      actions={<AssumptionBadge />}
    >
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No windows" description="No policies with a configured conversion window are approaching." />
      ) : (
        <div className="space-y-6">
          {tiers.map((t) => {
            const items = rows.data.filter((r) => r.urgency_tier === t.key)
            return (
              <div key={t.key} className="space-y-2">
                <p className="text-sm font-medium">{t.label} <span className="text-muted-foreground">({items.length})</span></p>
                <div className="flex flex-wrap gap-2">
                  {items.length === 0 ? <span className="text-xs text-muted-foreground">None</span> : items.map((r) => (
                    <Link key={r.policy_id} href={`/app/conversions/${r.policy_id}`}>
                      <Badge variant={r.is_security ? 'security' : 'outline'} className="cursor-pointer">{r.primary_name} · <Numeric>{r.days_remaining}d</Numeric></Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ReportShell>
  )
}
