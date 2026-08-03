'use client'

// src/components/app/AppointmentList.tsx
// Filterable / sortable / searchable operational list of appointments for the FSA command center
// (P2.2). Mirrors the HouseholdList archetype (client-side search + filter + CSV export with an
// audit ping) and reuses the shared appointment status→badge map and the existing status controls
// — no new backend, no second appointment source of truth.

import * as React from 'react'
import Link from 'next/link'
import { CalendarDays, Download } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { EmptyState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { STATUS_MAP } from '@/components/app/CalendarView'
import { AppointmentStatusControls } from '@/components/app/AppointmentStatusControls'
import { meetingModeLabel } from '@/lib/booking/display'

export interface AppointmentListRow {
  id: string
  /** Effective start (native starts_at, else legacy scheduled_at). */
  whenIso: string | null
  personName: string
  typeName: string | null
  status: string
  meetingMode: string | null
  bookedVia: string | null
}

type StatusFilter = 'all' | 'scheduled' | 'completed' | 'no_show' | 'cancelled'

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function badgeFor(status: string): { key: StatusKey; label: string } {
  return STATUS_MAP[status] ?? { key: 'draft', label: status }
}

export function AppointmentList({ rows }: { rows: AppointmentListRow[] }) {
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState<StatusFilter>('all')
  const [asc, setAsc] = React.useState(true)

  const filtered = React.useMemo(() => {
    let r = rows
    const n = q.trim().toLowerCase()
    if (n) {
      r = r.filter(
        (a) => a.personName.toLowerCase().includes(n) || (a.typeName ?? '').toLowerCase().includes(n),
      )
    }
    if (status !== 'all') r = r.filter((a) => a.status === status)
    // Sort by effective time; rows without a time sort to the end regardless of direction.
    return [...r].sort((a, b) => {
      if (!a.whenIso) return 1
      if (!b.whenIso) return -1
      const cmp = a.whenIso.localeCompare(b.whenIso)
      return asc ? cmp : -cmp
    })
  }, [rows, q, status, asc])

  function exportCsv() {
    const header = ['When', 'Who', 'Type', 'Format', 'Status']
    const lines = filtered.map((a) =>
      [fmtWhen(a.whenIso), a.personName, a.typeName ?? '', a.meetingMode ? meetingModeLabel(a.meetingMode) : '', a.status]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'appointments.csv'
    a.click()
    URL.revokeObjectURL(url)
    fetch('/api/audit/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'entity.viewed', entity: 'appointment', diff: { export: 'csv', count: filtered.length } }),
    }).catch(() => {})
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No appointments yet"
        description="Booked appointments — from the public scheduler or created from a review — appear here."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name or type…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
          aria-label="Search appointments"
        />
        <label className="sr-only" htmlFor="appt-status-filter">
          Filter by status
        </label>
        <Select
          id="appt-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-9 w-auto min-w-[9rem] text-sm"
        >
          <option value="all">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="no_show">No-show</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setAsc((v) => !v)} aria-label="Toggle sort direction">
          {asc ? 'Soonest first' : 'Latest first'}
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} className="ml-auto">
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No matches" description="Adjust your search or status filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Triage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const s = badgeFor(a.status)
                return (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{fmtWhen(a.whenIso)}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/app/calendar/${a.id}`} className="text-primary hover:underline">
                        {a.personName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.typeName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.meetingMode ? meetingModeLabel(a.meetingMode) : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.key} label={s.label} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {a.status === 'scheduled' ? <AppointmentStatusControls appointmentId={a.id} /> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
