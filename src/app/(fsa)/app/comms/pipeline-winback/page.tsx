import { ListShell, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { campaignAnalytics } from '@/lib/pipeline-winback/analytics'
import { CampaignControls } from './campaign-controls'

export const dynamic = 'force-dynamic'

// Pipeline Win-Back Campaign — operations dashboard (§5a/§12/§13). Campaign status + controls,
// eligibility + enrollment KPIs, win-back category + phase distribution, touch outcomes,
// advisor-task health, and the current enrollment roster. Read-only data; controls POST to the
// audited /api/pipeline-winback endpoints. Distinct from the imported /app/winback flow (ADR-031).

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  disabled: 'secondary',
  emergency_stopped: 'destructive',
  archived: 'outline',
  draft: 'outline',
  approval_pending: 'secondary',
}

const CATEGORY_LABEL: Record<string, string> = {
  lost: 'Lost opportunity',
  stalled_quote: 'Stalled quote',
  abandoned_application: 'Abandoned application',
  inactive: 'Inactive lead',
}

interface CampaignRow {
  id: string
  name: string
  status: string
  is_assumption: boolean
  simulated_at: string | null
}

interface EnrollmentRow {
  id: string
  status: string
  current_touch_no: number
  baseline_date: string
  winback_category: string | null
  stale_days_at_enroll: number | null
}

export default async function PipelineWinbackPage() {
  const campaigns = await load<CampaignRow[]>(
    (db) =>
      db
        .from('pipeline_winback_campaigns')
        .select('id, name, status, is_assumption, simulated_at')
        .order('created_at', { ascending: true })
        .limit(10),
    [],
  )

  if (!campaigns.ok) {
    return (
      <ListShell title="Win-Back Campaign" breadcrumb={crumb()}>
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      </ListShell>
    )
  }

  const campaign = campaigns.data[0]
  if (!campaign) {
    return (
      <ListShell title="Win-Back Campaign" breadcrumb={crumb()}>
        <EmptyState title="No campaign found" description="Run migration 084 to seed the Win-Back Campaign and its 24-touch timeline." />
      </ListShell>
    )
  }

  const [analytics, enrollments] = await Promise.all([
    campaignAnalytics(campaign.id),
    load<EnrollmentRow[]>(
      (db) =>
        db
          .from('pipeline_winback_enrollments')
          .select('id, status, current_touch_no, baseline_date, winback_category, stale_days_at_enroll')
          .eq('campaign_id', campaign.id)
          .order('updated_at', { ascending: false })
          .limit(50),
      [],
    ),
  ])

  const categoryEntries = Object.entries(analytics?.byCategory ?? {})

  return (
    <ListShell
      title="Win-Back Campaign"
      description="120-day, 24-touch multi-channel re-engagement for stalled internal pipeline opportunities. Every send passes the compliance gate; eligibility is rechecked before every touch. Distinct from the imported win-back list."
      breadcrumb={crumb()}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_TONE[campaign.status] ?? 'outline'}>{campaign.status.replace(/_/g, ' ')}</Badge>
          {campaign.is_assumption && <AssumptionBadge />}
        </div>
      }
    >
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Operational controls</h2>
          <CampaignControls campaignId={campaign.id} status={campaign.status} />
          {!campaign.simulated_at && campaign.status !== 'active' && (
            <p className="mt-3 text-xs text-muted-foreground">A read-only simulation is recommended before activation (ADR-021).</p>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile label="Eligible now" value={analytics?.eligibleNow ?? 0} hint="Stalled opportunities in v_pipeline_winback_due" />
          <StatTile label="Active enrollments" value={analytics?.active ?? 0} tone="brand" />
          <StatTile label="Completed (Day 120)" value={analytics?.completed ?? 0} />
          <StatTile label="Exited / suppressed" value={analytics?.exited ?? 0} />
          <StatTile label="Message touches sent" value={analytics?.touches.sent ?? 0} hint="Through the compliance gate" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Phase distribution (active)</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <PhaseCell label="Early (Day 1–41)" value={analytics?.byPhase.early ?? 0} />
              <PhaseCell label="Mid (Day 42–89)" value={analytics?.byPhase.mid ?? 0} />
              <PhaseCell label="Accelerated (90–120)" value={analytics?.byPhase.accelerated ?? 0} />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Advisor outreach health (§9a)</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <PhaseCell label="Fulfilled" value={analytics?.advisor.fulfilled ?? 0} />
              <PhaseCell label="Overdue" value={analytics?.advisor.overdue ?? 0} tone="attention" />
              <PhaseCell label="Missed" value={analytics?.advisor.missed ?? 0} />
            </div>
          </Card>
        </div>

        {categoryEntries.length > 0 && (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Win-back reason (enrolled)</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {categoryEntries.map(([key, value]) => (
                <PhaseCell key={key} label={CATEGORY_LABEL[key] ?? key} value={value} />
              ))}
            </div>
          </Card>
        )}

        <div>
          <h2 className="mb-2 text-sm font-semibold">Enrollments ({enrollments.ok ? enrollments.data.length : 0})</h2>
          {!enrollments.ok ? (
            <ErrorState description="Could not load enrollments." />
          ) : enrollments.data.length === 0 ? (
            <EmptyState
              title="No enrollments yet"
              description="Stalled internal opportunities are enrolled by the daily job or manually; each must be non-securities, opted-in, past the staleness floor, and free of an active advisor opportunity, appointment, or conversation."
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Touch</TableHead>
                    <TableHead>Baseline</TableHead>
                    <TableHead>Win-back reason</TableHead>
                    <TableHead>Stale at enroll</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments.data.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Badge variant={e.status === 'active' ? 'default' : 'outline'}>{e.status.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{e.current_touch_no} / 24</TableCell>
                      <TableCell className="text-muted-foreground">{e.baseline_date}</TableCell>
                      <TableCell className="text-muted-foreground">{e.winback_category ? (CATEGORY_LABEL[e.winback_category] ?? e.winback_category) : '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{e.stale_days_at_enroll != null ? `${e.stale_days_at_enroll}d` : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </ListShell>
  )
}

function PhaseCell({ label, value, tone }: { label: string; value: number; tone?: 'attention' }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === 'attention' && value > 0 ? 'border-amber-400/60' : ''}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function crumb() {
  return [
    { label: 'FSA', href: '/app' },
    { label: 'Comms', href: '/app/comms' },
    { label: 'Win-Back' },
  ]
}
