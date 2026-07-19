import Link from 'next/link'
import { Newspaper } from 'lucide-react'
import { PageHeader, Section } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { getServerSession } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { computeWidgets } from '@/lib/analytics/metrics'
import { DASHBOARD_WIDGETS } from '@/lib/analytics/catalog'
import { DashboardGrid } from '@/components/app/DashboardGrid'
import { TriageBand } from '@/components/app/TriageBand'
import type { DashboardWidgetPlacement } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'

// OS-01 Executive Dashboard (A1, P0). A personalized, per-user widget grid: the
// layout each user arranges (position/size/visibility) is saved automatically and
// restored on every login (migration 020). Every widget renders live from a
// DB-derived metric (lib/analytics/metrics.ts) so a saved layout can't drift, and
// every tile links to its source records (no dead ends). Widget compute and the
// saved-layout read each degrade to a labeled fallback so the page never blanks.
const ALL_KEYS = DASHBOARD_WIDGETS.map((w) => w.key)

export default async function FsaDashboardPage() {
  const session = await getServerSession()

  const [widgets, prefs] = await Promise.all([
    computeWidgets(ALL_KEYS),
    session
      ? load<{ layout: DashboardWidgetPlacement[] | null } | null>(
          (db) => db.from('dashboard_preferences').select('layout').eq('user_id', session.userId).maybeSingle(),
          null,
        )
      : Promise.resolve({ ok: true as const, data: null }),
  ])

  const savedLayout =
    prefs.ok && prefs.data && Array.isArray(prefs.data.layout) ? prefs.data.layout : null

  return (
    <div className="space-y-8">
      <PageHeader
        title="Executive Dashboard"
        description="Your book at a glance — triage first, then the numbers."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/app/executive/briefing">
              <Newspaper aria-hidden />
              Daily briefing
            </Link>
          </Button>
        }
      />

      {/* Read-me-first: the action-needed queues, loud when work is waiting. */}
      <TriageBand widgets={widgets} />

      {/* The personalized book — every user arranges it; it persists across logins. */}
      <Section
        title="Your book"
        description="Drag, resize, or add tiles — your layout is saved automatically."
      >
        <DashboardGrid widgets={widgets} initialLayout={savedLayout} />
      </Section>
    </div>
  )
}
