'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Download, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/forms/Field'
import { ModalShell } from '@/components/archetypes'
import { Money, Numeric } from '@/components/ui/typography'
import { EmptyState } from '@/components/archetypes'
import { AGENCY_STATUS } from '@/lib/validation/schemas'
import { patchJson, postJson, deleteJson, firstFieldError } from '@/lib/client/api'

export interface AgencyRow {
  id: string
  agency_name: string
  owner_name: string
  status: string
  ytd_placed_premium: number
  ytd_referrals: number
  last_contact_at: string | null
  archived_at: string | null
  overdue_checkin: boolean
}

const PAGE = 25

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString('en-US') : '—'
}

export function AgencyList({ rows, canManage = false }: { rows: AgencyRow[]; canManage?: boolean }) {
  const router = useRouter()
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [overdue, setOverdue] = React.useState(false)
  const [sort, setSort] = React.useState<'premium' | 'contact' | 'name'>('premium')
  const [page, setPage] = React.useState(0)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState<string | null>(null)
  const [bulk, setBulk] = React.useState<null | { scope: 'selected' | 'filter'; mode: 'archive' | 'purge' }>(null)
  const [confirmText, setConfirmText] = React.useState('')
  const [bulkBusy, setBulkBusy] = React.useState(false)

  const filtered = React.useMemo(() => {
    let r = rows
    const needle = q.trim().toLowerCase()
    if (needle) r = r.filter((a) => a.agency_name.toLowerCase().includes(needle) || a.owner_name.toLowerCase().includes(needle))
    if (status) r = r.filter((a) => a.status === status)
    if (overdue) r = r.filter((a) => a.overdue_checkin)
    r = [...r].sort((a, b) => {
      if (sort === 'name') return a.agency_name.localeCompare(b.agency_name)
      if (sort === 'contact') return (b.last_contact_at ?? '').localeCompare(a.last_contact_at ?? '')
      return (b.ytd_placed_premium ?? 0) - (a.ytd_placed_premium ?? 0)
    })
    return r
  }, [rows, q, status, overdue, sort])

  React.useEffect(() => setPage(0), [q, status, overdue, sort])

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))

  // Selection is constrained to the current filter set (across pages).
  const filteredIds = React.useMemo(() => new Set(filtered.map((r) => r.id)), [filtered])
  const selectedInFiltered = React.useMemo(() => [...selected].filter((id) => filteredIds.has(id)), [selected, filteredIds])
  const allFilteredSelected = filtered.length > 0 && selectedInFiltered.length === filtered.length
  // A filter narrows the directory — the basis for a safe "act on all matching".
  const structuredFilterActive = !!(status || q.trim() || overdue)
  const filterSummary = React.useMemo(() => {
    const parts: string[] = []
    if (status) parts.push(`status “${status}”`)
    if (overdue) parts.push('overdue check-in')
    if (q.trim()) parts.push(`matching “${q.trim()}”`)
    return parts.join(' · ') || 'the whole directory'
  }, [status, overdue, q])

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach((r) => next.delete(r.id))
      else filtered.forEach((r) => next.add(r.id))
      return next
    })
  }

  async function setArchived(a: AgencyRow, archived: boolean) {
    setBusy(a.id)
    const res = archived
      ? await postJson('/api/app/agencies/bulk-delete', { ids: [a.id], mode: 'archive' })
      : await patchJson(`/api/agencies/${a.id}`, { archived: false })
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(archived ? 'Agency archived.' : 'Agency restored.')
    router.refresh()
  }

  async function purgeOne(a: AgencyRow) {
    if (!window.confirm(`Permanently delete ${a.agency_name}? This removes the partnership, its owner records, delegations, and commission splits. Households, contacts, and policies it referred are kept but unlinked. This cannot be undone.`)) return
    setBusy(a.id)
    const res = await deleteJson(`/api/agencies/${a.id}?mode=purge`)
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success('Agency permanently deleted.')
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(a.id)
      return next
    })
    router.refresh()
  }

  const bulkTargetIds = bulk?.scope === 'selected' ? selectedInFiltered : filtered.map((r) => r.id)

  async function applyBulk() {
    if (!bulk) return
    if (bulk.mode === 'purge' && confirmText.trim().toUpperCase() !== 'DELETE') return toast.error('Type DELETE to confirm.')
    const ids = bulkTargetIds
    if (ids.length === 0) return
    setBulkBusy(true)
    const res = await postJson<{ affected: number }>('/api/app/agencies/bulk-delete', { ids, mode: bulk.mode })
    setBulkBusy(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message || res.error.reason || 'Operation failed.')
    toast.success(
      bulk.mode === 'purge'
        ? `Permanently deleted ${res.data.affected} agenc${res.data.affected === 1 ? 'y' : 'ies'}.`
        : `Archived ${res.data.affected} agenc${res.data.affected === 1 ? 'y' : 'ies'}.`,
    )
    setBulk(null)
    setConfirmText('')
    setSelected(new Set())
    router.refresh()
  }

  function exportCsv() {
    const header = ['Agency', 'Owner', 'Status', 'YTD Premium', 'YTD Referrals', 'Last Contact']
    const lines = filtered.map((a) =>
      [a.agency_name, a.owner_name, a.status, a.ytd_placed_premium, a.ytd_referrals, fmtDate(a.last_contact_at)]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'agencies.csv'
    a.click()
    URL.revokeObjectURL(url)
    // Export is audited server-side via a lightweight beacon.
    fetch('/api/audit/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'entity.viewed', entity: 'agency_partnership', diff: { export: 'csv', count: filtered.length } }),
    }).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search agency or owner…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
          aria-label="Search agencies"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[10rem]" aria-label="Filter status">
          <option value="">All statuses</option>
          {AGENCY_STATUS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="max-w-[12rem]" aria-label="Sort">
          <option value="premium">Sort: YTD premium</option>
          <option value="contact">Sort: last contact</option>
          <option value="name">Sort: name</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          Overdue check-in
        </label>
        <Button variant="outline" size="sm" onClick={exportCsv} className="ml-auto">
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {/* Act-on-all-matching — appears when a filter narrows the directory and the viewer
          may manage it. Operates on every matching agency, not just the current page. */}
      {canManage && structuredFilterActive && filtered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-sm">
            <span className="font-medium">{filtered.length}</span> match <span className="text-muted-foreground">{filterSummary}</span>.
          </span>
          <Button variant="outline" size="sm" onClick={() => { setConfirmText(''); setBulk({ scope: 'filter', mode: 'archive' }) }}>
            <Archive className="h-4 w-4" /> Archive all
          </Button>
          <Button variant="destructive" size="sm" onClick={() => { setConfirmText(''); setBulk({ scope: 'filter', mode: 'purge' }) }}>
            <Trash2 className="h-4 w-4" /> Delete all permanently
          </Button>
        </div>
      ) : null}

      {/* Bulk-action bar — appears when agencies are selected. */}
      {canManage && selectedInFiltered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selectedInFiltered.length} selected</span>
          <Button variant="outline" size="sm" onClick={() => { setConfirmText(''); setBulk({ scope: 'selected', mode: 'archive' }) }}>
            <Archive className="h-4 w-4" /> Archive
          </Button>
          <Button variant="destructive" size="sm" onClick={() => { setConfirmText(''); setBulk({ scope: 'selected', mode: 'purge' }) }}>
            <Trash2 className="h-4 w-4" /> Delete permanently
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No agency partnerships yet"
          description="Your book of agency-owner partnerships is the aggregate root of FSOS — start here."
          action={
            <Button asChild>
              <Link href="/app/agencies/new">Add your first agency partnership</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden sm:block rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {canManage ? (
                    <TableHead className="w-8">
                      <input type="checkbox" aria-label="Select all matching agencies" checked={allFilteredSelected} onChange={toggleAllFiltered} />
                    </TableHead>
                  ) : null}
                  <TableHead>Agency</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">YTD Premium</TableHead>
                  <TableHead className="text-right">Referrals</TableHead>
                  <TableHead>Last Contact</TableHead>
                  {canManage ? <TableHead className="w-10 text-right"><span className="sr-only">Actions</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((a) => (
                  <TableRow key={a.id} data-selected={selected.has(a.id) || undefined}>
                    {canManage ? (
                      <TableCell>
                        <input type="checkbox" aria-label={`Select ${a.agency_name}`} checked={selected.has(a.id)} onChange={() => toggleOne(a.id)} />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Link href={`/app/agencies/${a.id}`} className="font-medium text-primary hover:underline">
                        {a.agency_name}
                      </Link>
                      {a.overdue_checkin ? (
                        <Badge variant="pending" className="ml-2">
                          overdue check-in
                        </Badge>
                      ) : null}
                      {a.archived_at ? <Badge variant="draft" className="ml-2">archived</Badge> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.owner_name}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === 'producing' ? 'won' : a.status === 'terminated' ? 'lost' : 'active'}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right"><Money value={a.ytd_placed_premium} /></TableCell>
                    <TableCell className="text-right"><Numeric>{a.ytd_referrals}</Numeric></TableCell>
                    <TableCell className="text-muted-foreground"><Numeric>{fmtDate(a.last_contact_at)}</Numeric></TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {a.archived_at ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Restore" disabled={busy === a.id} onClick={() => setArchived(a, false)}><ArchiveRestore className="h-4 w-4" /></Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Archive" disabled={busy === a.id} onClick={() => setArchived(a, true)}><Archive className="h-4 w-4" /></Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete permanently" disabled={busy === a.id} onClick={() => purgeOne(a)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {pageRows.map((a) => (
              <Link
                key={a.id}
                href={`/app/agencies/${a.id}`}
                className="block rounded-lg border p-3 hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.agency_name}</span>
                  <Badge variant={a.status === 'producing' ? 'won' : 'active'}>{a.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{a.owner_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Money value={a.ytd_placed_premium} /> · <Numeric>{a.ytd_referrals}</Numeric> referrals
                  {a.overdue_checkin ? ' · overdue check-in' : ''}
                </p>
              </Link>
            ))}
          </div>

          {pages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {filtered.length} agencies · page {page + 1} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Bulk archive / permanent-delete confirmation. */}
      <ModalShell
        open={bulk !== null}
        onOpenChange={(o) => { if (!o) { setBulk(null); setConfirmText('') } }}
        title={bulk?.mode === 'purge' ? 'Permanently delete agencies?' : 'Archive agencies?'}
        description={
          bulk?.mode === 'purge'
            ? `This permanently removes ${bulkTargetIds.length} agenc${bulkTargetIds.length === 1 ? 'y' : 'ies'} (${bulk?.scope === 'filter' ? filterSummary : 'selected'}) along with their owner records, activation, delegations, and commission splits. Households, contacts, and policies they referred are kept but unlinked. This cannot be undone.`
            : `This archives ${bulkTargetIds.length} agenc${bulkTargetIds.length === 1 ? 'y' : 'ies'} (${bulk?.scope === 'filter' ? filterSummary : 'selected'}). They're hidden from active views but fully recoverable — nothing is deleted.`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => { setBulk(null); setConfirmText('') }} disabled={bulkBusy}>Cancel</Button>
            <Button
              variant={bulk?.mode === 'purge' ? 'destructive' : 'default'}
              onClick={applyBulk}
              disabled={bulkBusy || bulkTargetIds.length === 0 || (bulk?.mode === 'purge' && confirmText.trim().toUpperCase() !== 'DELETE')}
            >
              {bulkBusy ? 'Working…' : bulk?.mode === 'purge' ? `Delete ${bulkTargetIds.length} permanently` : `Archive ${bulkTargetIds.length}`}
            </Button>
          </>
        }
      >
        {bulk?.mode === 'purge' ? (
          <Field id="agency_delete_confirm" label="Type DELETE to confirm" required>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm permanent deletion" autoComplete="off" />
          </Field>
        ) : null}
      </ModalShell>
    </div>
  )
}
