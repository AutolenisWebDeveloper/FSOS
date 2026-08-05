import * as React from 'react'
import { Section, StatTile, EmptyState } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { CampaignStat, FunnelStat } from './CampaignKit'
import { winbackCategory, type CampaignEngine } from '@/lib/comms/campaign-presentation'
import type { CampaignAnalytics } from '@/lib/comms/campaign-analytics'

/*
 * One analytics panel for all three engines.
 *
 * Previously each page grouped the same underlying counts differently — Life put phase
 * distribution beside advisor health, Cross-Sell put channels beside advisor health and
 * funnel above both, Win-Back stacked four cards including touch outcomes that the other
 * two never showed at all. Same data, three layouts, so nothing transferred between screens.
 *
 * This renders the universal core, then any optional block the engine actually populated
 * (`funnel`/`rates`, `channels`, `byPhase`, `byCategory`). An engine that does not measure
 * a thing simply omits the block rather than rendering a row of zeroes.
 */

export function CampaignAnalyticsPanel({
  engine,
  analytics,
  phaseLabels,
}: {
  engine: CampaignEngine
  analytics: CampaignAnalytics | null
  /** Day-range labels for the three phases — the boundaries differ per engine. */
  phaseLabels?: { early: string; mid: string; accelerated: string }
}) {
  if (!analytics) {
    return (
      <Section title="Analytics" description="Live enrollment, touch, and advisor-outreach metrics.">
        <EmptyState
          title="No analytics yet"
          description="Metrics appear once this campaign has enrollments. Nothing has been measured for it so far."
        />
      </Section>
    )
  }

  const { totals, touches, advisor, funnel, rates, channels, byPhase, byCategory } = analytics
  const categoryEntries = Object.entries(byCategory ?? {})

  return (
    <Section
      title="Analytics"
      description="Live enrollment, touch, and advisor-outreach metrics. Opens are not counted as engagement — only inbound replies and terminal states advance a stage."
    >
      <div className="space-y-4">
        {/* ── The headline counts, on every engine ─────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {typeof analytics.eligibleNow === 'number' ? (
            <StatTile label="Eligible now" value={analytics.eligibleNow} hint="Waiting to be enrolled" />
          ) : null}
          <StatTile label="Active enrollments" value={totals.active} tone="brand" hint={totals.paused > 0 ? `${totals.paused} paused` : undefined} />
          <StatTile label={`Completed (Day ${engine.days})`} value={totals.completed} />
          <StatTile label="Exited / suppressed" value={totals.exited} hint={totals.suppressed > 0 ? `${totals.suppressed} suppressed` : undefined} />
          <StatTile label="Touches sent" value={touches.sent} hint="Through the compliance gate" />
        </div>

        {/* ── Conversion funnel — Cross-Sell Life only ─────────────────── */}
        {funnel && rates ? (
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Conversion funnel</h3>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <FunnelStat label="Enrolled" value={funnel.enrolled} />
              <FunnelStat label="Appointment" value={funnel.appointments} rate={rates.enrollToAppointment} rateLabel="of enrolled" />
              <FunnelStat label="Quote" value={funnel.quotes} rate={rates.appointmentToQuote} rateLabel="of appts" />
              <FunnelStat label="Application" value={funnel.applications} rate={rates.quoteToApplication} rateLabel="of quotes" />
              <FunnelStat label="Issued" value={funnel.issued} rate={rates.applicationToIssued} rateLabel="of apps" tone="brand" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Overall enrolled → issued: <span className="numeric font-medium">{rates.overall}%</span>
              {funnel.optOuts > 0 ? ` · ${funnel.optOuts} opted out` : ''}
              {funnel.purchasedElsewhere > 0 ? ` · ${funnel.purchasedElsewhere} bought elsewhere` : ''}
            </p>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Phase distribution — Life Conversion + Win-Back ────────── */}
          {byPhase && phaseLabels ? (
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Phase distribution (active)</h3>
              <div className="grid grid-cols-3 gap-3">
                <CampaignStat label={phaseLabels.early} value={byPhase.early} />
                <CampaignStat label={phaseLabels.mid} value={byPhase.mid} />
                <CampaignStat label={phaseLabels.accelerated} value={byPhase.accelerated} />
              </div>
            </Card>
          ) : null}

          {/* ── Channel sends — Cross-Sell Life only ───────────────────── */}
          {channels ? (
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Channel sends</h3>
              <div className="grid grid-cols-3 gap-3">
                <CampaignStat label="Email" value={channels.email} />
                <CampaignStat label="SMS" value={channels.sms} />
                <CampaignStat label="AI conversation" value={channels.ai} />
              </div>
            </Card>
          ) : null}

          {/* ── Advisor health — every engine ──────────────────────────── */}
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Advisor outreach health</h3>
            <div className="grid grid-cols-3 gap-3">
              <CampaignStat label="Fulfilled" value={advisor.fulfilled} />
              <CampaignStat label="Overdue" value={advisor.overdue} attentionWhenNonZero />
              <CampaignStat label="Missed" value={advisor.missed} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              A missed advisor task never stalls the timeline (§9a) — the campaign proceeds and logs the miss.
            </p>
          </Card>

          {/* ── Touch outcomes — every engine. Suppression stays visible. ─ */}
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Touch outcomes</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CampaignStat label="Sent" value={touches.sent} />
              <CampaignStat label="Suppressed" value={touches.suppressed} attentionWhenNonZero />
              <CampaignStat label="Skipped" value={touches.skipped} />
              <CampaignStat label="Scheduled" value={touches.scheduled} />
            </div>
            {touches.dead_letter > 0 || touches.missed > 0 ? (
              <p className="mt-3 text-xs text-status-pending">
                {touches.dead_letter > 0 ? `${touches.dead_letter} in the dead-letter queue. ` : ''}
                {touches.missed > 0 ? `${touches.missed} missed. ` : ''}
                These never reached anyone — check Monitoring &amp; health.
              </p>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                A suppressed touch was stopped by the compliance gate (consent, quiet hours, DNC, or the securities firewall).
              </p>
            )}
          </Card>

          {/* ── Win-back reason — Pipeline Win-Back only ───────────────── */}
          {byCategory ? (
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Win-back reason (enrolled)</h3>
              {categoryEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No enrollments yet, so there is nothing to break down.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {categoryEntries.map(([key, value]) => (
                    <CampaignStat key={key} label={winbackCategory(key)} value={value} />
                  ))}
                </div>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </Section>
  )
}
