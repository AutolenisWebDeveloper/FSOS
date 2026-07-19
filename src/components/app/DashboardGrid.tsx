'use client'

import * as React from 'react'
import Link from 'next/link'
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout'
import { Check, Plus, Settings2, X, RotateCcw, ArrowUpRight } from 'lucide-react'
import { toast } from 'sonner'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { MonoLabel, Numeric, Money } from '@/components/ui/typography'
import { putJson } from '@/lib/client/api'
import { DASHBOARD_WIDGETS, isAttentionWidget } from '@/lib/analytics/catalog'
import { widgetIcon } from './widgetIcons'
import type { WidgetValue } from '@/lib/analytics/metrics'
import type { DashboardWidgetPlacement } from '@/lib/validation/schemas'

const ResponsiveGridLayout = WidthProvider(Responsive)

// react-grid-layout tuning (design-system.md density). 12-col grid; a KPI tile is
// 3 wide × 2 tall by default (four per row). Editing is desktop-only; on tablet/
// mobile the same widgets stack in saved order, read-only.
const COLS = 12
const ROW_H = 64
const MARGIN: [number, number] = [16, 16]
const TILE_W = 3
const TILE_H = 2
const BREAKPOINTS = { lg: 1024, md: 768, sm: 640, xs: 0 }
const GRID_COLS = { lg: 12, md: 12, sm: 6, xs: 1 }

// A widget's saved placement plus its live catalog definition + computed value.
type Placement = DashboardWidgetPlacement

/** Default arrangement: every widget visible, four per row, in catalog order. */
function defaultLayout(): Placement[] {
  return DASHBOARD_WIDGETS.map((w, i) => ({
    key: w.key,
    x: (i % 4) * TILE_W,
    y: Math.floor(i / 4) * TILE_H,
    w: TILE_W,
    h: TILE_H,
    visible: true,
  }))
}

/**
 * Merge a saved layout with the catalog so newly-added catalog widgets always
 * appear (hidden by default, so they don't disrupt an existing arrangement) and
 * removed catalog keys are dropped.
 */
function reconcile(saved: Placement[] | null): Placement[] {
  if (!saved || saved.length === 0) return defaultLayout()
  const byKey = new Map(saved.map((p) => [p.key, p]))
  const known = new Set(DASHBOARD_WIDGETS.map((w) => w.key))
  let maxY = saved.reduce((m, p) => Math.max(m, p.y + p.h), 0)
  const out: Placement[] = []
  for (const w of DASHBOARD_WIDGETS) {
    const p = byKey.get(w.key)
    if (p) out.push({ ...p, key: w.key })
    else {
      // A catalog widget the user has never seen: add it hidden below the fold.
      out.push({ key: w.key, x: 0, y: maxY, w: TILE_W, h: TILE_H, visible: false })
      maxY += TILE_H
    }
  }
  return out.filter((p) => known.has(p.key))
}

function widgetValue(values: Map<string, WidgetValue>, key: string): React.ReactNode {
  const v = values.get(key)
  if (!v || v.value === null) return '—'
  if (v.kind === 'currency') return <Money value={v.value} />
  return <Numeric>{v.value.toLocaleString('en-US')}</Numeric>
}

export function DashboardGrid({
  widgets,
  initialLayout,
}: {
  widgets: WidgetValue[]
  initialLayout: Placement[] | null
}) {
  const values = React.useMemo(() => new Map(widgets.map((w) => [w.key, w])), [widgets])
  const defs = React.useMemo(() => new Map(DASHBOARD_WIDGETS.map((w) => [w.key, w])), [])

  const [placements, setPlacements] = React.useState<Placement[]>(() => reconcile(initialLayout))
  const [editing, setEditing] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Gate react-grid-layout behind mount so SSR and the first client render match
  // (both render the static fallback), avoiding a hydration mismatch.
  React.useEffect(() => setMounted(true), [])
  React.useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  const visible = placements.filter((p) => p.visible)
  const hidden = placements.filter((p) => !p.visible)

  // Book-level triage: which action-needed queues actually have work waiting.
  // Computed from live values (not tile visibility) so hiding a tile never hides
  // an alert. A failed metric (null) counts as calm — the tile itself shows the
  // retry note; we don't raise a false alarm on a load error.
  const attentionQueues = React.useMemo(
    () => DASHBOARD_WIDGETS.filter((w) => isAttentionWidget(w.key) && (values.get(w.key)?.value ?? 0) > 0),
    [values],
  )

  const persist = React.useCallback((next: Placement[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const res = await putJson('/api/dashboard/preferences', { layout: next })
      if (!res.ok) toast.error('Could not save your dashboard layout.')
    }, 700)
  }, [])

  const update = React.useCallback((next: Placement[]) => {
    setPlacements(next)
    persist(next)
  }, [persist])

  // Drag/resize → merge new x/y/w/h back into the visible placements (by key = `i`).
  const onLayoutChange = React.useCallback((layout: Layout[]) => {
    if (!editing) return
    setPlacements((prev) => {
      const pos = new Map(layout.map((l) => [l.i, l]))
      const next = prev.map((p) => {
        const l = pos.get(p.key)
        return l ? { ...p, x: l.x, y: l.y, w: l.w, h: l.h } : p
      })
      persist(next)
      return next
    })
  }, [editing, persist])

  const showWidget = (key: string) => {
    const maxY = placements.reduce((m, p) => (p.visible ? Math.max(m, p.y + p.h) : m), 0)
    update(placements.map((p) => (p.key === key ? { ...p, visible: true, x: 0, y: maxY } : p)))
    setAddOpen(false)
  }
  const hideWidget = (key: string) => update(placements.map((p) => (p.key === key ? { ...p, visible: false } : p)))
  const resetLayout = () => update(defaultLayout())

  const rglLayout: Layout[] = visible.map((p) => ({ i: p.key, x: p.x, y: p.y, w: p.w, h: p.h, minW: 2, minH: 2, maxH: 6 }))

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editing ? (
          <MonoLabel>Editing — drag to move, drag a corner to resize</MonoLabel>
        ) : (
          <TriageSummary queues={attentionQueues} />
        )}
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <div className="relative">
                <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen((o) => !o)} disabled={hidden.length === 0}>
                  <Plus className="h-4 w-4" /> Add widget{hidden.length ? ` (${hidden.length})` : ''}
                </Button>
                {addOpen && hidden.length > 0 ? (
                  <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border bg-popover p-1 shadow-md">
                    {hidden.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => showWidget(p.key)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" /> {defs.get(p.key)?.label ?? p.key}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={resetLayout}>
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
              <Button type="button" size="sm" onClick={() => { setEditing(false); setAddOpen(false) }}>
                <Check className="h-4 w-4" /> Done
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} className="hidden lg:inline-flex">
              <Settings2 className="h-4 w-4" /> Customize
            </Button>
          )}
        </div>
      </div>

      {/* Desktop: react-grid-layout. Tablet/mobile + pre-mount: static stacked grid. */}
      {mounted ? (
        <>
          <div className="hidden lg:block">
            <ResponsiveGridLayout
              className="-mx-2"
              layouts={{ lg: rglLayout, md: rglLayout }}
              breakpoints={BREAKPOINTS}
              cols={GRID_COLS}
              rowHeight={ROW_H}
              margin={MARGIN}
              isDraggable={editing}
              isResizable={editing}
              draggableCancel=".widget-nodrag"
              compactType="vertical"
              onLayoutChange={onLayoutChange}
            >
              {visible.map((p) => {
                const def = defs.get(p.key)
                const raw = values.get(p.key)?.value ?? null
                return (
                  <div key={p.key}>
                    <WidgetCard
                      def={def}
                      iconKey={p.key}
                      currency={values.get(p.key)?.kind === 'currency'}
                      value={widgetValue(values, p.key)}
                      unavailable={raw === null}
                      active={isAttentionWidget(p.key) && (raw ?? 0) > 0}
                      editing={editing}
                      onHide={() => hideWidget(p.key)}
                    />
                  </div>
                )
              })}
            </ResponsiveGridLayout>
          </div>
          <StackedGrid visible={visible} defs={defs} values={values} className="lg:hidden" />
        </>
      ) : (
        <StackedGrid visible={visible} defs={defs} values={values} />
      )}
    </div>
  )
}

// ─── A single widget tile ─────────────────────────────────────────────────────

function WidgetCard({
  def,
  iconKey,
  currency,
  value,
  unavailable,
  active,
  editing,
  onHide,
}: {
  def: { label: string; href: string; hint?: string; attention?: boolean } | undefined
  /** Widget key used to resolve the executive-KPI icon. */
  iconKey: string
  /** Currency metric — tints the icon chip brand-blue vs. neutral for counts. */
  currency?: boolean
  value: React.ReactNode
  unavailable: boolean
  /** An attention widget whose value > 0 — this tile has work waiting. */
  active?: boolean
  editing?: boolean
  onHide?: () => void
}) {
  if (!def) return null
  const Icon = widgetIcon(iconKey)
  // Attention state (referrals waiting, escalations, overdue) raises the tile to a
  // gold "needs you" treatment only while there's actually work; at 0 it stays the
  // calm baseline so a cleared queue recedes. Conveyed by icon + dot + text + color.
  const body = (
    <div
      className={cn(
        'group relative flex h-full flex-col justify-between overflow-hidden rounded-xl border bg-card p-4 shadow-elev-xs transition-all duration-200',
        active
          ? 'border-gold/45 bg-gradient-to-b from-gold/[0.07] to-transparent'
          : 'hover:border-primary/40',
        editing
          ? 'cursor-grab active:cursor-grabbing'
          : cn('hover:-translate-y-0.5 hover:shadow-md', active && 'hover:border-gold/70'),
      )}
    >
      {/* Top-lit hairline for a touch of financial-grade depth. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/60" />
      <div className="flex items-start justify-between gap-2">
        <span
          aria-hidden
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors',
            active
              ? 'bg-gold/15 text-gold-deep ring-gold/25'
              : currency
                ? 'bg-primary-soft/70 text-primary ring-primary/15'
                : 'bg-muted text-muted-foreground ring-border/60',
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
        {editing ? (
          <button
            type="button"
            aria-label={`Remove ${def.label}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onHide?.() }}
            className="widget-nodrag -mr-1 -mt-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ArrowUpRight
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 transition-all duration-200 group-hover:opacity-100',
              active ? 'group-hover:text-gold-deep' : 'group-hover:text-primary',
            )}
            aria-hidden
          />
        )}
      </div>
      <div className="mt-3">
        <div className="flex items-center gap-1.5">
          {active ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" /> : null}
          <MonoLabel muted={!active} className={cn('truncate', active && 'text-gold-deep')}>
            {def.label}
            {active ? <span className="sr-only"> — needs attention</span> : null}
          </MonoLabel>
        </div>
        <Numeric
          as="div"
          className={cn('mt-1.5 text-[30px] font-semibold leading-none tracking-tight', active && 'text-gold-deep')}
        >
          {value}
        </Numeric>
        {def.hint ? (
          <p className={cn('mt-2 text-xs', unavailable ? 'text-status-lost' : 'text-muted-foreground')}>
            {unavailable ? "Couldn't load — retry" : def.hint}
          </p>
        ) : null}
      </div>
    </div>
  )
  // In edit mode the whole tile is a drag handle (no navigation); otherwise it
  // links to its source records (anti-dead-end, design-system.md A1).
  if (editing) return body
  return (
    <Link href={def.href} className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl">
      {body}
    </Link>
  )
}

// The book-level "what needs me" line. Gold when any action queue has work; a
// calm, settled "All clear" when every queue is empty. The tiles carry the
// detail — this just orients the eye before it scans.
function TriageSummary({ queues }: { queues: readonly { key: string }[] }) {
  const n = queues.length
  if (n === 0) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <MonoLabel muted={false} className="text-muted-foreground">All clear</MonoLabel>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
      <MonoLabel muted={false} className="text-gold-deep">
        {n} {n === 1 ? 'queue needs' : 'queues need'} action
      </MonoLabel>
    </span>
  )
}

// Static fallback grid (SSR + tablet/mobile), same tiles in saved order.
function StackedGrid({
  visible,
  defs,
  values,
  className,
}: {
  visible: Placement[]
  defs: Map<string, { label: string; href: string; hint?: string; attention?: boolean }>
  values: Map<string, WidgetValue>
  className?: string
}) {
  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className ?? ''}`}>
      {visible.map((p) => {
        const def = defs.get(p.key)
        const raw = values.get(p.key)?.value ?? null
        return (
          <WidgetCard
            key={p.key}
            def={def}
            iconKey={p.key}
            currency={values.get(p.key)?.kind === 'currency'}
            value={widgetValue(values, p.key)}
            unavailable={raw === null}
            active={isAttentionWidget(p.key) && (raw ?? 0) > 0}
          />
        )
      })}
    </div>
  )
}
