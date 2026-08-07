'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { ALL, type FacetCount } from '@/lib/comms/template-catalog'

const BASE = '/app/comms/templates'

/**
 * OS-12 Templates — the list filter bar (DESIGN.md §8 "Filters": grouped, labeled,
 * active-filter chips + one-click clear all, state reflected in the URL).
 *
 * Two axes plus search. Type is the primary axis so it uses the canonical `Segmented`
 * control (`mode="choice"` radiogroup — roving tabindex, arrow keys); campaign is a native
 * select because the option list grows with every campaign. Every filter is written to the
 * URL query, so a view is deep-linkable, survives refresh and back/forward, and the server
 * component re-derives the list (DESIGN.md §12/§30 — no useState-only view state).
 *
 * Counts are computed server-side per axis with the OTHER filters applied, so an option
 * showing 0 is genuinely empty in the current view rather than merely empty overall.
 */
export function TemplateFilters({
  formats,
  campaigns,
  current,
}: {
  formats: FacetCount[]
  campaigns: FacetCount[]
  current: { format: string; campaign: string; q: string }
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [q, setQ] = React.useState(current.q)

  // Keep the input in sync when the URL changes underneath it (back/forward, clear all).
  React.useEffect(() => setQ(current.q), [current.q])

  // One axis changes; the others are preserved. `all` drops the param entirely so the
  // canonical unfiltered view has a clean URL.
  const href = React.useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (!value || value === ALL) next.delete(key)
      else next.set(key, value)
      const qs = next.toString()
      return qs ? `${BASE}?${qs}` : BASE
    },
    [params],
  )

  const go = React.useCallback((key: string, value: string) => router.push(href(key, value)), [href, router])

  function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    go('q', q.trim())
  }

  const formatOptions: SegmentedOption<string>[] = formats.map((f) => ({ value: f.value, label: f.label, hint: f.count }))

  const campaignLabelOf = (value: string) => campaigns.find((c) => c.value === value)?.label ?? value
  const formatLabelOf = (value: string) => formats.find((f) => f.value === value)?.label ?? value

  const activeChips = [
    current.format !== ALL ? { key: 'format', label: `Type: ${formatLabelOf(current.format)}` } : null,
    current.campaign !== ALL ? { key: 'campaign', label: `Campaign: ${campaignLabelOf(current.campaign)}` } : null,
    current.q ? { key: 'q', label: `Search: “${current.q}”` } : null,
  ].filter((c): c is { key: string; label: string } => c !== null)

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3" role="search" aria-label="Filter templates">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="mono-label mb-1.5 text-xs text-muted-foreground">Type</p>
          <Segmented
            label="Template type"
            options={formatOptions}
            value={current.format}
            onChange={(v) => go('format', v)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="tpl-campaign" className="mono-label text-xs text-muted-foreground">
            Campaign
          </label>
          <select
            id="tpl-campaign"
            value={current.campaign}
            onChange={(e) => go('campaign', e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {campaigns.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={onSearch} className="flex flex-col gap-1">
          <label htmlFor="tpl-q" className="mono-label text-xs text-muted-foreground">
            Search
          </label>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="tpl-q"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name or category…"
                className="h-9 w-52 pl-8"
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </div>
        </form>
      </div>

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
          <span className="mono-label text-xs text-muted-foreground">Active</span>
          {activeChips.map((chip) => (
            <Button
              key={chip.key}
              size="sm"
              variant="secondary"
              className="h-7 gap-1 rounded-full px-2.5 text-xs font-normal"
              onClick={() => go(chip.key, ALL)}
            >
              {chip.label}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">Remove this filter</span>
            </Button>
          ))}
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link href={BASE}>Clear all</Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
