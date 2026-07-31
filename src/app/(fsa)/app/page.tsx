import Link from 'next/link'
import { Newspaper } from 'lucide-react'
import { Section } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { MonoLabel } from '@/components/ui/typography'
import { getServerSession, getCurrentUserEmail } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { computeWidgets } from '@/lib/analytics/metrics'
import { DASHBOARD_WIDGETS } from '@/lib/analytics/catalog'
import { getExecutiveDashboard } from '@/lib/dashboards/executive'
import { DashboardGrid } from '@/components/app/DashboardGrid'
import { ExecutiveKpiStrip } from '@/components/app/ExecutiveKpiStrip'
import { FnaPlanningIntelligence } from '@/components/fna/FnaPlanningIntelligence'
import { BriefingHero } from '@/components/app/executive/BriefingHero'
import { PriorityQueue } from '@/components/app/executive/PriorityQueue'
import { PipelinePanel } from '@/components/app/executive/PipelinePanel'
import { WorkspaceLauncher } from '@/components/app/executive/WorkspaceLauncher'
import { ActivityFeed } from '@/components/app/executive/ActivityFeed'
import type { DashboardWidgetPlacement } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'

// OS-01 Executive Dashboard (A1, P0) — the FSA's command center. A curated premium
// composition (briefing → priorities → performance → pipeline → launch → activity)
// wired ENTIRELY to real signals (lib/dashboards/executive), never mock numbers;
// each section degrades to a labeled empty state. The personalized, per-user
// DashboardGrid (saved layout, migration 020) and the planning intelligence are
// preserved below so no existing functionality is lost.
const ALL_KEYS = DASHBOARD_WIDGETS.map((w) => w.key)

function greeting(): string {
  // Single-FSA app in McKinney, TX — greet in the advisor's local (Central) time.
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }))
  if (!Number.isFinite(hour)) return 'Welcome back'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function firstNameFrom(email: string | null): string | null {
  if (!email) return null
  const local = email.split('@')[0]?.split(/[._-]/)[0]
  if (!local) return null
  return local.charAt(0).toUpperCase() + local.slice(1)
}

export default async function FsaDashboardPage() {
  const session = await getServerSession()

  const [widgets, prefs, email] = await Promise.all([
    computeWidgets(ALL_KEYS),
    session
      ? load<{ layout: DashboardWidgetPlacement[] | null } | null>(
          (db) => db.from('dashboard_preferences').select('layout').eq('user_id', session.userId).maybeSingle(),
          null,
        )
      : Promise.resolve({ ok: true as const, data: null }),
    getCurrentUserEmail(),
  ])

  const dash = await getExecutiveDashboard(widgets)
  const savedLayout = prefs.ok && prefs.data && Array.isArray(prefs.data.layout) ? prefs.data.layout : null
  const name = firstNameFrom(email)

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px]">
            {greeting()}{name ? `, ${name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Here&apos;s what&apos;s happening in your book today.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/executive/briefing"><Newspaper aria-hidden /> Daily briefing</Link>
        </Button>
      </div>

      {/* Briefing + priority queue */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BriefingHero briefing={dash.briefing} priorityCount={dash.priorities.length} />
        </div>
        <PriorityQueue items={dash.priorities} />
      </div>

      {/* Business performance — production KPIs (current values; no fabricated trend) */}
      <section aria-label="Business performance" className="space-y-3">
        <MonoLabel className="text-muted-foreground">Business performance</MonoLabel>
        <ExecutiveKpiStrip widgets={widgets} />
      </section>

      {/* Pipeline health + activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelinePanel funnel={dash.funnel} revenue={dash.revenue} />
        </div>
        <ActivityFeed items={dash.activities} />
      </div>

      {/* Launch a workspace */}
      <WorkspaceLauncher />

      {/* Preserved: the personalized book grid (saved per-user layout) + planning. */}
      <Section title="Your custom metrics" description="Drag, resize, or add tiles — your layout is saved automatically.">
        <DashboardGrid widgets={widgets} initialLayout={savedLayout} />
      </Section>

      <FnaPlanningIntelligence />
    </div>
  )
}
