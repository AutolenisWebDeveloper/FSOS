'use client'

import * as React from 'react'
import Link from 'next/link'
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout'
import { Check, Plus, Settings2, X, RotateCcw, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { MonoLabel, Numeric, Money } from '@/components/ui/typography'
import { putJson } from '@/lib/client/api'
import { DASHBOARD_WIDGETS } from '@/lib/analytics/catalog'
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
        <MonoLabel>{editing ? 'Editing — drag to move, drag a corner to resize' : 'Your dashboard'}</MonoLabel>
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
              {visible.map((p) => (
                <div key={p.key}>
                  <WidgetCard
                    def={defs.get(p.key)}
                    value={widgetValue(values, p.key)}
                    unavailable={values.get(p.key)?.value === null}
                    editing={editing}
                    onHide={() => hideWidget(p.key)}
                  />
                </div>
              ))}
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
  value,
  unavailable,
  editing,
  onHide,
}: {
  def: { label: string; href: string; hint?: string } | undefined
  value: React.ReactNode
  unavailable: boolean
  editing?: boolean
  onHide?: () => void
}) {
  if (!def) return null
  const body = (
    <div
      className={cn(
        'group relative flex h-full flex-col justify-between overflow-hidden rounded-xl border bg-card p-4 shadow-elev-xs transition-all duration-200',
        editing ? 'cursor-grab active:cursor-grabbing' : 'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
      )}
    >
      {!editing ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-primary/0 transition-colors duration-200 group-hover:bg-primary/70"
        />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <MonoLabel>{def.label}</MonoLabel>
        {editing ? (
          <button
            type="button"
            aria-label={`Remove ${def.label}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onHide?.() }}
            className="widget-nodrag -mr-1 -mt-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div>
        <div className="flex items-end justify-between gap-2">
          <Numeric as="div" className="text-[28px] font-semibold leading-none tracking-tight">
            {value}
          </Numeric>
          {!editing ? (
            <ChevronRight
              className="h-4 w-4 shrink-0 -translate-x-1 text-muted-foreground/50 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-primary group-hover:opacity-100"
              aria-hidden
            />
          ) : null}
        </div>
        {def.hint ? <p className="mt-1.5 text-xs text-muted-foreground">{unavailable ? "Couldn't load — retry" : def.hint}</p> : null}
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

// Static fallback grid (SSR + tablet/mobile), same tiles in saved order.
function StackedGrid({
  visible,
  defs,
  values,
  className,
}: {
  visible: Placement[]
  defs: Map<string, { label: string; href: string; hint?: string }>
  values: Map<string, WidgetValue>
  className?: string
}) {
  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className ?? ''}`}>
      {visible.map((p) => (
        <WidgetCard key={p.key} def={defs.get(p.key)} value={widgetValue(values, p.key)} unavailable={values.get(p.key)?.value === null} />
      ))}
    </div>
  )
}
