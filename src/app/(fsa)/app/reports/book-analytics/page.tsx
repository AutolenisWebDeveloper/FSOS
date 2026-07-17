import { ReportShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money, Numeric, MonoLabel } from '@/components/ui/typography'
import { loadBookAnalytics, type Dist } from '@/lib/analytics/reports'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Book Analytics — the App B rebuild of App A's live Reports dashboard. Headline
// totals + pipeline / lead-source / case-status / 30-day-activity distributions +
// FSA commission by month, all DB-derived from the App B spine (lib/analytics/reports).

const STAGE_LABEL: Record<string, string> = {
  prospect: 'Prospect',
  fact_find: 'Fact find',
  quoted_proposed: 'Quoted / proposed',
  application: 'Application',
  underwriting_suitability: 'Underwriting / suitability',
  placed_issued: 'Placed / issued',
  lost: 'Lost',
}
const ENGAGEMENT_LABEL: Record<string, string> = {
  warm_handoff: 'Warm handoff',
  co_sell: 'Co-sell',
  direct: 'Direct',
}
const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function BarList({ title, rows, labelMap }: { title: string; rows: Dist[]; labelMap?: Record<string, string> }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.label} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate">{labelMap?.[r.label] ?? humanize(r.label)}</span>
                  <Numeric className="text-muted-foreground">{r.count.toLocaleString('en-US')}</Numeric>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export default async function BookAnalyticsPage() {
  const res = await loadBookAnalytics()

  if (!res.ok) {
    return (
      <ReportShell title="Book analytics" description="Live headline metrics across the book.">
        {res.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set the Supabase environment variables to load analytics." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ReportShell>
    )
  }

  const a = res.data
  const t = a.totals
  const maxMonth = a.gdc_by_month.reduce((m, r) => Math.max(m, r.fsa), 0) || 1

  return (
    <ReportShell
      title="Book analytics"
      description="Live headline metrics across the book — households, policies, cases, tasks, pipeline, and commission. DB-derived; no drift."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Households" value={t.households} href="/app/households" />
        <StatTile label="Policies" value={t.policies} href="/app/policies" />
        <StatTile label="Open cases" value={t.open_cases} href="/app/cases" />
        <StatTile label="Issued cases" value={t.issued_cases} href="/app/cases" />
        <StatTile label="Open tasks" value={t.open_tasks} href="/app/tasks" />
        <StatTile label="Overdue tasks" value={t.overdue_tasks} href="/app/tasks" hint="Past due" />
        <StatTile label="FSA commission" value={<Money value={t.fsa_commission} />} href="/app/commissions" hint="Received / matched" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <BarList title="Pipeline by stage" rows={a.pipeline} labelMap={STAGE_LABEL} />
        <BarList title="Referrals by engagement" rows={a.sources} labelMap={ENGAGEMENT_LABEL} />
        <BarList title="Cases by status" rows={a.case_status} />
        <BarList title="Activity (last 30 days)" rows={a.activity_30d} />
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">FSA commission by month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3" style={{ height: 120 }}>
            {a.gdc_by_month.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(2, Math.round((m.fsa / maxMonth) * 96))}px` }} title={`$${m.fsa.toLocaleString('en-US')}`} />
                <MonoLabel className="text-[10px]">{m.month.slice(5)}</MonoLabel>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">Generated {new Date(a.generated_at).toLocaleString('en-US')}.</p>
    </ReportShell>
  )
}
