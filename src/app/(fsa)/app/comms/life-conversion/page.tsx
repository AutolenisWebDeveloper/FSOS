import Link from 'next/link'
import { ListShell, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { campaignAnalytics } from '@/lib/life-campaign/analytics'
import { CampaignControls } from '@/components/app/CampaignEngineControls'

export const dynamic = 'force-dynamic'

// Life Conversion Campaign — operations dashboard (§4b/§15). Campaign status + controls,
// enrollment KPIs, phase distribution, touch outcomes, advisor-task health, and the current
// enrollment roster. Read-only data; controls POST to the audited /api/life-campaign endpoints.

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  disabled: 'secondary',
  emergency_stopped: 'destructive',
  archived: 'outline',
  draft: 'outline',
  approval_pending: 'secondary',
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
  conversion_deadline: string | null
}

export default async function LifeConversionPage() {
  const campaigns = await load<CampaignRow[]>(
    (db) => db.from('life_campaigns').select('id, name, status, is_assumption, simulated_at').order('created_at', { ascending: true }).limit(10),
    [],
  )

  if (!campaigns.ok) {
    return (
      <ListShell title="Life Conversion Campaign" breadcrumb={crumb()}>
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      </ListShell>
    )
  }

  const campaign = campaigns.data[0]
  if (!campaign) {
    return (
      <ListShell title="Life Conversion Campaign" breadcrumb={crumb()}>
        <EmptyState title="No campaign found" description="Run migration 082 to seed the Life Conversion Campaign and its 20-touch timeline." />
      </ListShell>
    )
  }

  const [analytics, enrollments] = await Promise.all([
    campaignAnalytics(campaign.id),
    load<EnrollmentRow[]>(
      (db) => db.from('life_campaign_enrollments').select('id, status, current_touch_no, baseline_date, conversion_deadline').eq('campaign_id', campaign.id).order('updated_at', { ascending: false }).limit(50),
      [],
    ),
  ])

  return (
    <ListShell
      title="Life Conversion Campaign"
      description="180-day, 20-touch multi-channel term-conversion review campaign. Every send passes the compliance gate; eligibility is rechecked before every touch."
      breadcrumb={crumb()}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_TONE[campaign.status] ?? 'outline'}>{campaign.status.replace(/_/g, ' ')}</Badge>
          {campaign.is_assumption && <AssumptionBadge />}
          <Link
            href={`/app/comms/life-conversion/${campaign.id}`}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            View full details →
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <Link
          href={`/app/comms/life-conversion/${campaign.id}`}
          className="block rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/40"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{campaign.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Configuration, schedule, assets, workflows, analytics, settings & controls →</p>
            </div>
            <Badge variant={STATUS_TONE[campaign.status] ?? 'outline'}>{campaign.status.replace(/_/g, ' ')}</Badge>
          </div>
        </Link>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Operational controls</h2>
          <CampaignControls campaignId={campaign.id} status={campaign.status} endpoint="/api/life-campaign" />
          {!campaign.simulated_at && campaign.status !== 'active' && (
            <p className="mt-3 text-xs text-muted-foreground">A read-only simulation is recommended before activation (ADR-021).</p>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Active enrollments" value={analytics?.active ?? 0} tone="brand" />
          <StatTile label="Completed (Day 180)" value={analytics?.completed ?? 0} />
          <StatTile label="Exited / suppressed" value={analytics?.exited ?? 0} />
          <StatTile label="Message touches sent" value={analytics?.touches.sent ?? 0} hint="Through the compliance gate" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Phase distribution (active)</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <PhaseCell label="Early (Day 1–47)" value={analytics?.byPhase.early ?? 0} />
              <PhaseCell label="Mid (Day 48–134)" value={analytics?.byPhase.mid ?? 0} />
              <PhaseCell label="Accelerated (135–180)" value={analytics?.byPhase.accelerated ?? 0} />
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

        <div>
          <h2 className="mb-2 text-sm font-semibold">Enrollments ({enrollments.ok ? enrollments.data.length : 0})</h2>
          {!enrollments.ok ? (
            <ErrorState description="Could not load enrollments." />
          ) : enrollments.data.length === 0 ? (
            <EmptyState title="No enrollments yet" description="Eligible term-conversion contacts are enrolled by the daily job or manually; each must have a verified deadline and no active opportunity." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Touch</TableHead>
                    <TableHead>Baseline</TableHead>
                    <TableHead>Conversion deadline</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments.data.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell><Badge variant={e.status === 'active' ? 'default' : 'outline'}>{e.status.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{e.current_touch_no} / 20</TableCell>
                      <TableCell className="text-muted-foreground">{e.baseline_date}</TableCell>
                      <TableCell className="text-muted-foreground">{e.conversion_deadline ?? '—'}</TableCell>
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
    <div className={`rounded-lg border p-3 ${tone === 'attention' && value > 0 ? 'border-status-pending/60' : ''}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function crumb() {
  return [
    { label: 'FSA', href: '/app' },
    { label: 'Comms', href: '/app/comms' },
    { label: 'Life Conversion' },
  ]
}
