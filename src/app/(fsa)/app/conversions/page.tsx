import Link from 'next/link'
import { DashboardShell, StatTile, CardsSkeleton, ErrorState } from '@/components/archetypes'
import { AssumptionBadge } from '@/components/archetypes'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-07 Term Conversion Dashboard (A1). Educational outreach only — no product steering.
export default async function ConversionsDashboardPage() {
  const due = await load<{ policy_id: string; urgency_tier: string; is_security: boolean }[]>(
    (db) => db.from('v_conversions_due').select('policy_id, urgency_tier, is_security'),
    [],
  )
  if (!due.ok) {
    return (
      <DashboardShell title="Term Conversion" description="Educational conversion outreach — never product-specific.">
        {due.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={due.message} />}
      </DashboardShell>
    )
  }
  const rows = due.data.filter((r) => !r.is_security) // securities excluded from automation
  const tier = (t: string) => rows.filter((r) => r.urgency_tier === t).length
  const t30 = tier('30'), t90 = tier('90') + t30, t180 = tier('180') + t90, t365 = tier('365') + t180

  return (
    <DashboardShell
      title="Term Conversion"
      description="Detect approaching conversion windows; invite to a review. Educational only."
    >
      <StatTile label="≤30 days" value={t30} href="/app/conversions/eligible?tier=30" hint="Urgent" />
      <StatTile label="≤90 days" value={t90} href="/app/conversions/eligible?tier=90" />
      <StatTile label="≤180 days" value={t180} href="/app/conversions/eligible?tier=180" />
      <StatTile label="≤365 days" value={t365} href="/app/conversions/eligible?tier=365" />
      <div className="sm:col-span-2 lg:col-span-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <AssumptionBadge />
          <span className="text-muted-foreground">Conversion windows are config defaults — verify against the FNWL / ICC25-FTL contract. Securities-flagged policies are excluded from automated sends.</span>
          <Link href="/app/conversions/eligible" className="text-primary hover:underline">Eligible list</Link>
          <Link href="/app/conversions/timeline" className="text-primary hover:underline">Timeline</Link>
          <Link href="/app/conversions/analytics" className="text-primary hover:underline">Analytics</Link>
        </div>
      </div>
    </DashboardShell>
  )
}
