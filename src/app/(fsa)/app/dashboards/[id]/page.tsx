import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { computeWidgets } from '@/lib/analytics/metrics'
import { DashboardControls } from '@/components/app/DashboardControls'

export const dynamic = 'force-dynamic'

interface DashboardDetail {
  id: string
  name: string
  description: string | null
  layout: string[] | null
  visibility: string
  archived_at: string | null
  updated_at: string
}

function formatValue(kind: 'count' | 'currency', value: number | null): string {
  if (value === null) return '—'
  if (kind === 'currency') return `$${value.toLocaleString('en-US')}`
  return value.toLocaleString('en-US')
}

// OS-01 Custom dashboard render (A1). Widgets compute from live, DB-derived
// metrics; each tile is fetched independently so one failing metric never blanks
// the board, and every tile links to its underlying list (no dead ends).
export default async function DashboardDetailPage({ params }: { params: { id: string } }) {
  const res = await load<DashboardDetail | null>(
    (db) => db.from('dashboards').select('id, name, description, layout, visibility, archived_at, updated_at').eq('id', params.id).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const d = res.data
  if (!d) notFound()

  const layout = Array.isArray(d.layout) ? d.layout : []
  const widgets = await computeWidgets(layout)
  const archived = Boolean(d.archived_at)

  return (
    <div className="space-y-6">
      <PageHeader
        title={d.name}
        description={d.description ?? 'Custom dashboard'}
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Dashboards', href: '/app/dashboards' }, { label: d.name }]}
        actions={archived ? undefined : <DashboardControls id={d.id} />}
      />

      {archived ? (
        <div className="rounded-md border border-status-blocked/40 bg-status-blocked/10 p-3 text-sm text-status-blocked">
          This dashboard is archived (read-only).
        </div>
      ) : null}

      {widgets.length === 0 ? (
        <EmptyState
          title="No widgets on this dashboard"
          description="Edit the dashboard to add widgets from the catalog."
          action={<Link href="/app/dashboards/builder" className="text-primary hover:underline">Open the builder</Link>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {widgets.map((w) => (
            <StatTile
              key={w.key}
              label={w.label}
              value={formatValue(w.kind, w.value)}
              href={w.href}
              hint={w.value === null ? "Couldn't load — retry" : w.hint}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Every tile is derived from live data and links to its underlying records. Weighted-pipeline uses editable forecast assumptions —{' '}
        <Link href="/app/forecasts" className="text-primary hover:underline">review them on Forecasts</Link>.
      </p>
    </div>
  )
}
