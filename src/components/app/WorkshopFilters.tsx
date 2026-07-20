'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export interface FilterOption {
  value: string
  label: string
}

// Dashboard filter bar (spec §3.3). Native selects that push the chosen filters into the
// URL query so the server component re-aggregates. Presenter/fund-family is first-class
// (multiple wholesalers). Keyboard-operable + labelled (WCAG 2.2 AA).
export function WorkshopFilters({
  statuses,
  deliveryModes,
  presenters,
  current,
}: {
  statuses: FilterOption[]
  deliveryModes: FilterOption[]
  presenters: FilterOption[]
  current: { status: string; delivery: string; presenter: string; year: string }
}) {
  const router = useRouter()
  const params = useSearchParams()

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value === 'all' || value === '') next.delete(key)
    else next.set(key, value)
    router.push(`/app/workshops?${next.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select id="f-status" label="Status" value={current.status} onChange={(v) => update('status', v)} options={[{ value: 'all', label: 'All statuses' }, ...statuses]} />
      <Select id="f-delivery" label="Delivery" value={current.delivery} onChange={(v) => update('delivery', v)} options={[{ value: 'all', label: 'All formats' }, ...deliveryModes]} />
      <Select
        id="f-presenter"
        label="Presenter / fund family"
        value={current.presenter}
        onChange={(v) => update('presenter', v)}
        options={[{ value: 'all', label: 'All presenters' }, ...presenters]}
      />
      <Select
        id="f-year"
        label="Year"
        value={current.year}
        onChange={(v) => update('year', v)}
        options={yearOptions(current.year)}
      />
    </div>
  )
}

function yearOptions(current: string): FilterOption[] {
  const c = Number(current)
  const years = [c + 1, c, c - 1, c - 2].filter((y) => Number.isFinite(y))
  return years.map((y) => ({ value: String(y), label: String(y) }))
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: FilterOption[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="mono-label text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
