'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Users, Download, PanelRightOpen, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/forms/Field'
import { ModalShell } from '@/components/archetypes'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/archetypes'
import { ContactPeek } from '@/components/archetypes/contact/peek'
import { CONTACT_VIEWS, type ContactViewKey } from '@/lib/contacts/views'
import { patchJson, postJson, deleteJson, firstFieldError } from '@/lib/client/api'

export interface HouseholdRow {
  id: string
  primary_name: string
  referring_agency_id?: string | null
  agency_name: string | null
  members: number
  policies: number
  opportunities: number
  do_not_contact: boolean
  archived_at: string | null
  /** Saved views this household belongs to (§4.1); always includes 'all'. */
  views: string[]
}

export interface AgencyOption {
  id: string
  name: string
}

export function HouseholdList({
  rows,
  viewCounts,
  agencyOptions = [],
  canManage = false,
  initialView = 'all',
}: {
  rows: HouseholdRow[]
  viewCounts?: Record<string, number>
  /** Referring agencies present in the book — the agency filter/delete dimension. */
  agencyOptions?: AgencyOption[]
  /** Whether the viewer may archive / permanently delete (fsa / super_admin). */
  canManage?: boolean
  /** Saved view preselected from the URL (?view=), e.g. a Win-Back deep link. */
  initialView?: ContactViewKey
}) {
  const router = useRouter()
  const [q, setQ] = React.useState('')
  const [dncOnly, setDncOnly] = React.useState(false)
  const [view, setView] = React.useState<ContactViewKey>(initialView)
  const [agency, setAgency] = React.useState('')
  const [peekId, setPeekId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState<string | null>(null)

  // Bulk archive / permanent-delete flow. scope = the checked rows or the whole current
  // filter; mode = recoverable archive vs permanent purge.
  const [bulk, setBulk] = React.useState<null | { scope: 'selected' | 'filter'; mode: 'archive' | 'purge' }>(null)
  const [confirmText, setConfirmText] = React.useState('')
  const [bulkBusy, setBulkBusy] = React.useState(false)

  const filtered = React.useMemo(() => {
    let r = rows
    if (view !== 'all') r = r.filter((h) => h.views.includes(view))
    if (agency) r = r.filter((h) => (h.referring_agency_id ?? '') === agency)
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((h) => h.primary_name.toLowerCase().includes(n) || (h.agency_name ?? '').toLowerCase().includes(n))
    if (dncOnly) r = r.filter((h) => h.do_not_contact)
    return r
  }, [rows, q, dncOnly, view, agency])

  const filteredIds = React.useMemo(() => new Set(filtered.map((r) => r.id)), [filtered])
  const selectedVisible = React.useMemo(() => [...selected].filter((id) => filteredIds.has(id)), [selected, filteredIds])
  const allVisibleSelected = filtered.length > 0 && selectedVisible.length === filtered.length
  // A structured (view or agency) filter is active — the basis for "act on all matching".
  const structuredFilterActive = view !== 'all' || !!agency || dncOnly

  const filterSummary = React.useMemo(() => {
    const parts: string[] = []
    if (view !== 'all') parts.push(`view “${CONTACT_VIEWS.find((v) => v.key === view)?.label ?? view}”`)
    if (agency) parts.push(`agency “${agencyOptions.find((a) => a.id === agency)?.name ?? agency}”`)
    if (dncOnly) parts.push('DNC only')
    return parts.join(' · ') || 'the whole book'
  }, [view, agency, dncOnly, agencyOptions])

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach((r) => next.delete(r.id))
      else filtered.forEach((r) => next.add(r.id))
      return next
    })
  }

  // Row-level archive / restore.
  async function setArchived(h: HouseholdRow, archived: boolean) {
    setBusy(h.id)
    const res = archived
      ? await postJson('/api/app/households/bulk-delete', { ids: [h.id], mode: 'archive' })
      : await patchJson(`/api/households/${h.id}`, { archived: false })
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(archived ? 'Household archived.' : 'Household restored.')
    router.refresh()
  }

  // Row-level permanent delete (hard, cascade).
  async function purgeOne(h: HouseholdRow) {
    if (!window.confirm(`Permanently delete ${h.primary_name} and everything under it — members, policies, reviews, plans, and enrollments? This cannot be undone.`)) return
    setBusy(h.id)
    const res = await deleteJson(`/api/households/${h.id}?mode=purge`)
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success('Household permanently deleted.')
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(h.id)
      return next
    })
    router.refresh()
  }

  const bulkTargetIds = bulk?.scope === 'selected' ? selectedVisible : filtered.map((r) => r.id)

  async function applyBulk() {
    if (!bulk) return
    if (bulk.mode === 'purge' && confirmText.trim().toUpperCase() !== 'DELETE') return toast.error('Type DELETE to confirm.')
    const ids = bulkTargetIds
    if (ids.length === 0) return
    setBulkBusy(true)
    const res = await postJson<{ affected: number }>('/api/app/households/bulk-delete', { ids, mode: bulk.mode })
    setBulkBusy(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message || res.error.reason || 'Operation failed.')
    toast.success(
      bulk.mode === 'purge'
        ? `Permanently deleted ${res.data.affected} household${res.data.affected === 1 ? '' : 's'}.`
        : `Archived ${res.data.affected} household${res.data.affected === 1 ? '' : 's'}.`,
    )
    setBulk(null)
    setConfirmText('')
    setSelected(new Set())
    router.refresh()
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No households yet"
        description="Households enter your book from a converted referral, or add one directly."
        action={
          <div className="flex gap-2">
            <Button asChild><Link href="/app/households/new">Add household</Link></Button>
            <Button asChild variant="outline"><Link href="/app/referrals">Convert a referral</Link></Button>
          </div>
        }
      />
    )
  }

  function exportCsv() {
    const header = ['Household', 'Referring agency', 'Members', 'Policies', 'Opportunities', 'DNC']
    const lines = filtered.map((h) => [h.primary_name, h.agency_name ?? '', h.members, h.policies, h.opportunities, h.do_not_contact ? 'yes' : 'no'].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'households.csv'
    a.click()
    URL.revokeObjectURL(url)
    fetch('/api/audit/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'entity.viewed', entity: 'household', diff: { export: 'csv', count: filtered.length } }) }).catch(() => {})
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
      {/* Saved-view rail (§4.1) — the per-workflow lists as filters over one book. */}
      <nav aria-label="Saved views" className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
        {CONTACT_VIEWS.map((v) => {
          const active = v.key === view
          const n = viewCounts?.[v.key]
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm transition-colors lg:w-full',
                active ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span>{v.label}</span>
              {typeof n === 'number' ? <span className="tabular-nums text-xs text-muted-foreground">{n}</span> : null}
            </button>
          )
        })}
      </nav>

      <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search household or agency…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search households" />
        {agencyOptions.length > 0 ? (
          <Select value={agency} onChange={(e) => setAgency(e.target.value)} className="w-auto" aria-label="Filter by referring agency">
            <option value="">All agencies</option>
            {agencyOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        ) : null}
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={dncOnly} onChange={(e) => setDncOnly(e.target.checked)} /> DNC only
        </label>
        <Button variant="outline" size="sm" onClick={exportCsv} className="ml-auto"><Download className="h-4 w-4" /> Export</Button>
      </div>

      {/* Act-on-all-matching — appears when a saved view / agency / DNC filter is active
          and the viewer may manage the book. Operates on every matching household. */}
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

      {/* Bulk-action bar — appears when households are selected. */}
      {canManage && selectedVisible.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selectedVisible.length} selected</span>
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
        <EmptyState icon={Users} title="No matches" description="Adjust your search or filters." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {canManage ? (
                  <TableHead className="w-8">
                    <input type="checkbox" aria-label="Select all visible households" checked={allVisibleSelected} onChange={toggleAllVisible} />
                  </TableHead>
                ) : null}
                <TableHead>Household</TableHead>
                <TableHead>Referring agency</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Policies</TableHead>
                <TableHead className="text-right">Opportunities</TableHead>
                <TableHead className="w-10 text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((h) => (
                <TableRow key={h.id} data-selected={selected.has(h.id) || undefined}>
                  {canManage ? (
                    <TableCell>
                      <input type="checkbox" aria-label={`Select ${h.primary_name}`} checked={selected.has(h.id)} onChange={() => toggleOne(h.id)} />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Link href={`/app/households/${h.id}`} className="font-medium text-primary hover:underline">{h.primary_name}</Link>
                    {h.do_not_contact ? <Badge variant="blocked" className="ml-2">DNC</Badge> : null}
                    {h.archived_at ? <Badge variant="draft" className="ml-2">archived</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{h.agency_name ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.members}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.policies}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.opportunities}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPeekId(h.id)} aria-label={`Peek at ${h.primary_name}`} title="Quick look">
                        <PanelRightOpen className="h-4 w-4" />
                      </Button>
                      {canManage ? (
                        <>
                          {h.archived_at ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Restore" disabled={busy === h.id} onClick={() => setArchived(h, false)}><ArchiveRestore className="h-4 w-4" /></Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Archive" disabled={busy === h.id} onClick={() => setArchived(h, true)}><Archive className="h-4 w-4" /></Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete permanently" disabled={busy === h.id} onClick={() => purgeOne(h)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{filtered.length} household{filtered.length === 1 ? '' : 's'} shown.</p>
      <ContactPeek householdId={peekId} onOpenChange={(v) => !v && setPeekId(null)} />

      {/* Bulk archive / permanent-delete confirmation. */}
      <ModalShell
        open={bulk !== null}
        onOpenChange={(o) => { if (!o) { setBulk(null); setConfirmText('') } }}
        title={bulk?.mode === 'purge' ? 'Permanently delete households?' : 'Archive households?'}
        description={
          bulk?.mode === 'purge'
            ? `This permanently removes ${bulkTargetIds.length} household${bulkTargetIds.length === 1 ? '' : 's'} (${bulk?.scope === 'filter' ? filterSummary : 'selected'}) and everything under them — members, policies, reviews, FNA plans, and campaign enrollments. This cannot be undone.`
            : `This archives ${bulkTargetIds.length} household${bulkTargetIds.length === 1 ? '' : 's'} (${bulk?.scope === 'filter' ? filterSummary : 'selected'}). They're hidden from active views but fully recoverable — policies and history are kept.`
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
          <Field id="household_delete_confirm" label="Type DELETE to confirm" required>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm permanent deletion" autoComplete="off" />
          </Field>
        ) : null}
      </ModalShell>
      </div>
    </div>
  )
}
