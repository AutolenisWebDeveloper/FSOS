import { ReportShell, ErrorState, StatTile } from '@/components/archetypes'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-07 Conversion Analytics (A11).
export default async function ConversionAnalyticsPage() {
  const [due, activity] = await Promise.all([
    load<{ policy_id: string; is_security: boolean }[]>((db) => db.from('v_conversions_due').select('policy_id, is_security'), []),
    load<{ kind: string | null }[]>((db) => db.from('activities').select('kind').eq('entity_type', 'policy').like('kind', 'conversion_%').limit(5000), []),
  ])
  if (!due.ok) return <ReportShell title="Conversion Analytics"><ErrorState description={due.kind === 'not_configured' ? 'Database not configured.' : due.message} /></ReportShell>

  const windows = due.data.filter((d) => !d.is_security).length
  const acts = activity.ok ? activity.data : []
  const count = (k: string) => acts.filter((a) => a.kind === `conversion_${k}`).length
  const invited = count('invite') + count('educate')
  const scheduled = count('schedule')

  return (
    <ReportShell title="Conversion Analytics" description="Windows entered, enrolled, scheduled. Educational outreach only.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Windows in period" value={windows} href="/app/conversions/eligible" />
        <StatTile label="Educational / invites" value={invited} href="/app/conversions/monitoring" />
        <StatTile label="Reviews scheduled" value={scheduled} href="/app/reviews" />
        <StatTile label="Escalations" value={count('advice')} href="/app/ai/escalations" />
      </div>
      <p className="text-xs text-muted-foreground">Export CSV/PDF is available from the Reports library. Every send passes the 7-step gate.</p>
    </ReportShell>
  )
}
