import Link from 'next/link'
import { ListShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { campaignAnalytics } from '@/lib/district-nurture/analytics'
import { TOUCH_SCHEDULE } from '@/lib/district-nurture/schedule'
import { CampaignControls } from '@/components/app/CampaignEngineControls'
import { CAMPAIGN_ENGINES, campaignBreadcrumb, campaignDetailHref } from '@/lib/comms/campaign-presentation'
import { CampaignStatusBadge, CampaignHeaderActions, CampaignStat } from '@/components/comms/campaign/CampaignKit'
import { CampaignEnrollmentTable } from '@/components/comms/campaign/CampaignEnrollmentTable'
import { CampaignStateLine } from '@/components/comms/campaign/CampaignStateLine'
import { CampaignControlsSection } from '@/components/comms/campaign/CampaignControlsSection'

export const dynamic = 'force-dynamic'

// The Second Conversation — District Agent FS Nurture operations dashboard (ADR-038). Agent-facing
// 12-month curriculum. Matches the list → [id] shape of the three client engines; the full
// campaign (curriculum, content library, analytics, controls) lives at [id]/page.tsx.

const ENGINE = CAMPAIGN_ENGINES.district_nurture

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
}

/** Curriculum module for an enrollment's current touch cursor. */
function moduleForTouch(touchNo: number): string {
  const t = TOUCH_SCHEDULE.find((x) => x.touch_no === touchNo)
  if (!t) return '—'
  return t.module_no ? `Module ${t.module_no}` : 'Live touchpoint'
}

export default async function DistrictNurturePage() {
  const campaigns = await load<CampaignRow[]>(
    (db) =>
      db
        .from('district_nurture_campaigns')
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
          description={`Run migration ${ENGINE.seedMigration} to seed “The Second Conversation” and its ${ENGINE.touches}-touch, ${ENGINE.days}-day curriculum.`}
        />
      </ListShell>
    )
  }

  const [analytics, enrollments] = await Promise.all([
    campaignAnalytics(campaign.id),
    load<EnrollmentRow[]>(
      (db) =>
        db
          .from('district_nurture_enrollments')
          .select('id, status, current_touch_no, baseline_date')
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
                Curriculum, eligibility, schedule, content library, analytics, settings, and controls
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
          <StatTile label="Eligible agents" value={analytics?.eligibleNow ?? 0} hint="Reachable district agents" />
          <StatTile label="Active enrollments" value={analytics?.totals.active ?? 0} tone="brand" />
          <StatTile label={`Completed (Day ${ENGINE.days})`} value={analytics?.totals.completed ?? 0} />
          <StatTile label="Touches sent" value={analytics?.touches.sent ?? 0} hint="Through the compliance gate" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Curriculum phase (active)</h2>
            <div className="grid grid-cols-3 gap-3">
              <CampaignStat label="Foundations (Mod 1–4)" value={analytics?.byPhase?.early ?? 0} />
              <CampaignStat label="Products & FNA (Mod 5–8)" value={analytics?.byPhase?.mid ?? 0} />
              <CampaignStat label="Advanced & legacy (Mod 9–12)" value={analytics?.byPhase?.accelerated ?? 0} />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Live touchpoint health</h2>
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
          emptyDescription="District agents are enrolled by the daily job or manually. Each must be a reachable, non-terminated agency owner who has not opted out and is not already enrolled."
          extraColumns={[{ header: 'Curriculum', cell: (row) => moduleForTouch(row.current_touch_no) }]}
        />
      </div>
    </ListShell>
  )
}
