import Link from 'next/link'
import { ListShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { campaignAnalytics } from '@/lib/pipeline-winback/analytics'
import { CampaignControls } from '@/components/app/CampaignEngineControls'
import { CAMPAIGN_ENGINES, campaignBreadcrumb, campaignDetailHref, winbackCategory } from '@/lib/comms/campaign-presentation'
import { CampaignStatusBadge, CampaignHeaderActions, CampaignStat } from '@/components/comms/campaign/CampaignKit'
import { CampaignEnrollmentTable } from '@/components/comms/campaign/CampaignEnrollmentTable'
import { CampaignStateLine } from '@/components/comms/campaign/CampaignStateLine'
import { CampaignControlsSection } from '@/components/comms/campaign/CampaignControlsSection'

export const dynamic = 'force-dynamic'

// Pipeline Win-Back Campaign — operations dashboard. Previously this route WAS the detail page:
// a single 440-line surface rendering a DetailShell where a list belongs, with no [id] route at
// all, even though loadCampaignDetail had already been built. It now matches the list → [id]
// shape of Life Conversion and Cross-Sell Life; the full campaign lives at [id]/page.tsx.
// Distinct from the imported /app/winback origination flow (ADR-031).

const ENGINE = CAMPAIGN_ENGINES.pipeline_winback

interface CampaignRow {
  id: string
  name: string
  status: string
  simulated_at: string | null
}

interface EnrollmentRow {
  id: string
  status: string
  current_touch_no: number
  baseline_date: string
  winback_category: string | null
}

export default async function PipelineWinbackPage() {
  const campaigns = await load<CampaignRow[]>(
    (db) =>
      db
        .from('pipeline_winback_campaigns')
        .select('id, name, status, simulated_at')
        .order('created_at', { ascending: true })
        .limit(10),
    [],
  )

  if (!campaigns.ok) {
    return (
      <ListShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      </ListShell>
    )
  }

  const campaign = campaigns.data[0]
  if (!campaign) {
    return (
      <ListShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <EmptyState
          title="No campaign found"
          description={`Run migration ${ENGINE.seedMigration} to seed the ${ENGINE.title} campaign and its ${ENGINE.touches}-touch timeline.`}
        />
      </ListShell>
    )
  }

  const [analytics, enrollments] = await Promise.all([
    campaignAnalytics(campaign.id),
    load<EnrollmentRow[]>(
      (db) =>
        db
          .from('pipeline_winback_enrollments')
          .select('id, status, current_touch_no, baseline_date, winback_category')
          .eq('campaign_id', campaign.id)
          .order('updated_at', { ascending: false })
          .limit(50),
      [],
    ),
  ])

  return (
    <ListShell
      title={ENGINE.title}
      description={ENGINE.description}
      breadcrumb={campaignBreadcrumb(ENGINE)}
      actions={
        <CampaignHeaderActions
          engine={ENGINE}
          status={campaign.status}
          manageHref={campaignDetailHref(ENGINE, campaign.id)}
        />
      }
    >
      <div className="space-y-6">
        <Link
          href={campaignDetailHref(ENGINE, campaign.id)}
          className="block rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{campaign.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Configuration, eligibility, schedule, assets, workflows, analytics, settings, and controls
              </p>
            </div>
            <CampaignStatusBadge status={campaign.status} />
          </div>
        </Link>

        <CampaignStateLine
          status={campaign.status}
          simulatedAt={campaign.simulated_at}
          activeEnrollments={analytics?.totals.active ?? 0}
          pausedEnrollments={analytics?.totals.paused ?? 0}
          suppressedTouches={analytics?.touches.suppressed ?? 0}
          deadLetterTouches={analytics?.touches.dead_letter ?? 0}
          overdueAdvisorTasks={analytics?.advisor.overdue ?? 0}
        />

        <CampaignControlsSection engine={ENGINE} status={campaign.status} simulatedAt={campaign.simulated_at}>
          <CampaignControls campaignId={campaign.id} status={campaign.status} endpoint={ENGINE.apiRoot} />
        </CampaignControlsSection>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Eligible now" value={analytics?.eligibleNow ?? 0} hint="Stalled opportunities waiting" />
          <StatTile label="Active enrollments" value={analytics?.totals.active ?? 0} tone="brand" />
          <StatTile label={`Completed (Day ${ENGINE.days})`} value={analytics?.totals.completed ?? 0} />
          <StatTile label="Touches sent" value={analytics?.touches.sent ?? 0} hint="Through the compliance gate" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Phase distribution (active)</h2>
            <div className="grid grid-cols-3 gap-3">
              <CampaignStat label="Early (Day 1–41)" value={analytics?.byPhase?.early ?? 0} />
              <CampaignStat label="Mid (Day 42–89)" value={analytics?.byPhase?.mid ?? 0} />
              <CampaignStat label="Accelerated (Day 90–120)" value={analytics?.byPhase?.accelerated ?? 0} />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Advisor outreach health</h2>
            <div className="grid grid-cols-3 gap-3">
              <CampaignStat label="Fulfilled" value={analytics?.advisor.fulfilled ?? 0} />
              <CampaignStat label="Overdue" value={analytics?.advisor.overdue ?? 0} attentionWhenNonZero />
              <CampaignStat label="Missed" value={analytics?.advisor.missed ?? 0} />
            </div>
          </Card>
        </div>

        <CampaignEnrollmentTable
          engine={ENGINE}
          rows={enrollments.ok ? enrollments.data : null}
          error={!enrollments.ok}
          emptyDescription="Stalled internal opportunities are enrolled by the daily job or manually. Each must be non-securities, opted in, past the staleness floor, and free of an active advisor opportunity, appointment, or conversation."
          extraColumns={[{ header: 'Win-back reason', cell: (row) => winbackCategory(row.winback_category) }]}
        />
      </div>
    </ListShell>
  )
}
