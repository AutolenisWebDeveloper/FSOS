'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Archive, ArchiveRestore, Trash2, Ban, CircleCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { ModalShell } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel } from '@/components/ui/typography'
import { EmptyState } from '@/components/archetypes'
import { patchJson, deleteJson, postJson, firstFieldError } from '@/lib/client/api'
import { CONTACT_TYPE_LABEL } from '@/components/app/contactMeta'

// Re-exported for callers that already import it from here. The value itself
// lives in a plain (non-client) module so server components can dot into it.
export { CONTACT_TYPE_LABEL }

export interface ContactRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  company: string | null
  contact_type: string
  tags: string[]
  status: string
  created_at: string
  /** Campaign — the contact's origin `source` stream (winback_life, cross_sell, …). */
  source?: string | null
  /** Agency — agency_partnership_id + resolved display name. */
  agency_partnership_id?: string | null
  agency_name?: string | null
}

/** Effective, per-contact suppression state — the three layers shown DISTINCTLY. */
export interface ContactSuppressionView {
  /** Client-level (individual) business block. */
  individual: boolean
  /** Agent-level (the contact's agency book) business block. */
  agent: boolean
  /** Regulatory do-not-contact (STOP / unsubscribe / consent revoke). */
  dnc: boolean
}

export interface AgencyOption {
  id: string
  name: string
}

export function ContactList({
  rows,
  suppression = {},
  canManageComms = false,
  canDelete = false,
  agencyOptions = [],
  campaignOptions = [],
  groupOptions = [],
}: {
  rows: ContactRow[]
  suppression?: Record<string, ContactSuppressionView>
  canManageComms?: boolean
  /** Whether the viewer may PERMANENTLY delete (fsa / super_admin). */
  canDelete?: boolean
  /** Agencies present in the book — the "referring agency" filter/delete dimension. */
  agencyOptions?: AgencyOption[]
  /** Campaign (source) streams present in the book. */
  campaignOptions?: string[]
  /** Groups (tags) present in the book. */
  groupOptions?: string[]
}) {
  const router = useRouter()
  const [q, setQ] = React.useState('')
  const [type, setType] = React.useState('')
  const [agency, setAgency] = React.useState('')
  const [campaign, setCampaign] = React.useState('')
  const [group, setGroup] = React.useState('')
  const [showArchived, setShowArchived] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = React.useState<null | 'blocked' | 'active'>(null)
  const [bulkReason, setBulkReason] = React.useState('')
  const [bulkBusy, setBulkBusy] = React.useState(false)

  // Permanent-delete flow. 'selected' targets the checked rows by id; 'filter' targets
  // every contact matching the active campaign/agency/group/type filter server-side.
  const [deleteMode, setDeleteMode] = React.useState<null | 'selected' | 'filter'>(null)
  const [deleteConfirm, setDeleteConfirm] = React.useState('')
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [filterCount, setFilterCount] = React.useState<number | null>(null)

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (!showArchived && r.status === 'archived') return false
      if (showArchived && r.status !== 'archived') return false
      if (type && r.contact_type !== type) return false
      if (agency && (r.agency_partnership_id ?? '') !== agency) return false
      if (campaign && (r.source ?? '') !== campaign) return false
      if (group && !r.tags.includes(group)) return false
      if (!needle) return true
      return (
        r.full_name.toLowerCase().includes(needle) ||
        (r.email || '').toLowerCase().includes(needle) ||
        (r.phone || '').includes(needle) ||
        (r.company || '').toLowerCase().includes(needle) ||
        (r.source || '').toLowerCase().includes(needle) ||
        (r.agency_name || '').toLowerCase().includes(needle) ||
        r.tags.some((t) => t.toLowerCase().includes(needle))
      )
    })
  }, [rows, q, type, agency, campaign, group, showArchived])

  // Keep the selection within the currently visible rows (filtering shouldn't act on hidden ones).
  const filteredIds = React.useMemo(() => new Set(filtered.map((r) => r.id)), [filtered])
  const selectedVisible = React.useMemo(() => [...selected].filter((id) => filteredIds.has(id)), [selected, filteredIds])
  const allVisibleSelected = filtered.length > 0 && selectedVisible.length === filtered.length

  // A structured (campaign/agency/group/type) filter is active — the discriminating
  // criterion the server accepts for a "delete all matching" purge. Free-text search is
  // deliberately excluded: it can't be reproduced server-side, so the bulk-by-filter
  // delete acts only on the structured dimensions.
  const serverFilter = React.useMemo(
    () => ({
      agencyPartnershipId: agency || undefined,
      source: campaign || undefined,
      contactType: type || undefined,
      tag: group || undefined,
      status: (showArchived ? 'archived' : 'active') as 'archived' | 'active',
    }),
    [agency, campaign, type, group, showArchived],
  )
  const structuredFilterActive = !!(agency || campaign || type || group)

  const filterSummary = React.useMemo(() => {
    const parts: string[] = []
    if (campaign) parts.push(`Campaign “${campaign}”`)
    if (agency) parts.push(`Agency “${agencyOptions.find((a) => a.id === agency)?.name ?? agency}”`)
    if (group) parts.push(`Group “${group}”`)
    if (type) parts.push(`Type “${CONTACT_TYPE_LABEL[type] ?? type}”`)
    parts.push(showArchived ? 'archived' : 'active')
    return parts.join(' · ')
  }, [campaign, agency, group, type, showArchived, agencyOptions])

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

  async function archive(r: ContactRow, next: 'active' | 'archived') {
    setBusy(r.id)
    const res = await patchJson(`/api/app/contacts/${r.id}`, { status: next })
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(next === 'archived' ? 'Contact archived.' : 'Contact restored.')
    router.refresh()
  }

  // Permanent (hard) delete of a single contact.
  async function remove(r: ContactRow) {
    if (!window.confirm(`Permanently delete ${r.full_name}? This removes the record for good and cannot be undone.`)) return
    setBusy(r.id)
    const res = await deleteJson(`/api/app/contacts/${r.id}?mode=purge`)
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success('Contact permanently deleted.')
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(r.id)
      return next
    })
    router.refresh()
  }

  // Individual (single-row) block / unblock.
  async function setBlock(r: ContactRow, next: 'blocked' | 'active') {
    if (next === 'blocked') {
      const reason = window.prompt(`Reason for blocking communications to ${r.full_name}? (recorded in the audit log)`)
      if (reason == null) return
      if (reason.trim().length < 3) return toast.error('A reason (min 3 chars) is required to block.')
      setBusy(r.id)
      const res = await postJson('/api/app/comms/suppression', { scope: 'client', contactIds: [r.id], status: 'blocked', reason: reason.trim() })
      setBusy(null)
      if (!res.ok) return toast.error(firstFieldError(res.error).message || res.error.reason || 'Could not block.')
      toast.success('Client communications blocked.')
    } else {
      setBusy(r.id)
      const res = await postJson('/api/app/comms/suppression', { scope: 'client', contactIds: [r.id], status: 'active' })
      setBusy(null)
      if (!res.ok) return toast.error(firstFieldError(res.error).message || res.error.reason || 'Could not reactivate.')
      toast.success('Client communications reactivated.')
    }
    router.refresh()
  }

  // Bulk block / unblock of the selected (visible) contacts.
  async function applyBulk() {
    const ids = selectedVisible
    if (ids.length === 0) return
    if (bulkOpen === 'blocked' && bulkReason.trim().length < 3) return toast.error('A reason (min 3 chars) is required to block.')
    setBulkBusy(true)
    const res = await postJson('/api/app/comms/suppression', {
      scope: 'client',
      contactIds: ids,
      status: bulkOpen,
      reason: bulkOpen === 'blocked' ? bulkReason.trim() : undefined,
    })
    setBulkBusy(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message || res.error.reason || 'Bulk update failed.')
    toast.success(
      bulkOpen === 'blocked'
        ? `Blocked communications for ${ids.length} client${ids.length === 1 ? '' : 's'}.`
        : `Reactivated communications for ${ids.length} client${ids.length === 1 ? '' : 's'}.`,
    )
    setBulkOpen(null)
    setBulkReason('')
    setSelected(new Set())
    router.refresh()
  }

  // Open the permanent-delete confirmation. For a filter-driven delete, resolve the exact
  // target count first (dryRun) so the operator sees "this will delete N" before confirming.
  async function openDelete(mode: 'selected' | 'filter') {
    setDeleteConfirm('')
    setFilterCount(null)
    setDeleteMode(mode)
    if (mode === 'filter') {
      const res = await postJson<{ count: number }>('/api/app/contacts/bulk-delete', { filter: serverFilter, dryRun: true })
      if (!res.ok) {
        setDeleteMode(null)
        return toast.error(firstFieldError(res.error).message || 'Could not preview the delete.')
      }
      setFilterCount(res.data.count)
    }
  }

  async function confirmDelete() {
    if (deleteConfirm.trim().toUpperCase() !== 'DELETE') return toast.error('Type DELETE to confirm.')
    setDeleteBusy(true)
    const body = deleteMode === 'selected' ? { ids: selectedVisible } : { filter: serverFilter }
    const res = await postJson<{ deleted: number }>('/api/app/contacts/bulk-delete', body)
    setDeleteBusy(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message || res.error.reason || 'Delete failed.')
    toast.success(`Permanently deleted ${res.data.deleted} contact${res.data.deleted === 1 ? '' : 's'}.`)
    setDeleteMode(null)
    setDeleteConfirm('')
    setSelected(new Set())
    router.refresh()
  }

  const deleteTargetCount = deleteMode === 'selected' ? selectedVisible.length : filterCount ?? 0

  const types = Array.from(new Set(rows.map((r) => r.contact_type)))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, company, tag…" className="pl-8" aria-label="Search contacts" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto" aria-label="Filter by type">
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{CONTACT_TYPE_LABEL[t] ?? t}</option>
          ))}
        </Select>
        {agencyOptions.length > 0 ? (
          <Select value={agency} onChange={(e) => setAgency(e.target.value)} className="w-auto" aria-label="Filter by agency">
            <option value="">All agencies</option>
            {agencyOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        ) : null}
        {campaignOptions.length > 0 ? (
          <Select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="w-auto" aria-label="Filter by campaign">
            <option value="">All campaigns</option>
            {campaignOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        ) : null}
        {groupOptions.length > 0 ? (
          <Select value={group} onChange={(e) => setGroup(e.target.value)} className="w-auto" aria-label="Filter by group">
            <option value="">All groups</option>
            {groupOptions.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </Select>
        ) : null}
        <Button variant={showArchived ? 'default' : 'outline'} size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Viewing archived' : 'Active'}
        </Button>
        {structuredFilterActive ? (
          <Button variant="ghost" size="sm" onClick={() => { setType(''); setAgency(''); setCampaign(''); setGroup('') }}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* Delete-all-matching-filter — appears when a campaign/agency/group/type filter is
          active and the viewer may purge. Deletes the whole matching set server-side, not
          just the loaded page. */}
      {canDelete && structuredFilterActive ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-sm">
            <span className="font-medium">{filtered.length}</span> shown match <span className="text-muted-foreground">{filterSummary}</span>.
          </span>
          <Button variant="destructive" size="sm" onClick={() => openDelete('filter')}>
            <Trash2 className="h-4 w-4" /> Delete all matching
          </Button>
        </div>
      ) : null}

      {/* Bulk-action bar — appears when contacts are selected. */}
      {selectedVisible.length > 0 && (canManageComms || canDelete) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selectedVisible.length} selected</span>
          {canManageComms ? (
            <>
              <span className="text-xs text-muted-foreground">Communication suppression:</span>
              <Button variant="destructive" size="sm" onClick={() => setBulkOpen('blocked')}>
                <Ban className="h-4 w-4" /> Block
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBulkOpen('active')}>
                <CircleCheck className="h-4 w-4" /> Reactivate
              </Button>
            </>
          ) : null}
          {canDelete ? (
            <Button variant="destructive" size="sm" onClick={() => openDelete('selected')}>
              <Trash2 className="h-4 w-4" /> Delete permanently
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No contacts" description={q || type || agency || campaign || group ? 'No contacts match the current filters.' : 'Add a contact or import a file to get started.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {canManageComms || canDelete ? (
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all visible contacts"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </TableHead>
                ) : null}
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Communications</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const sup = suppression[r.id]
                const individuallyBlocked = !!sup?.individual
                return (
                  <TableRow key={r.id} data-selected={selected.has(r.id) || undefined}>
                    {canManageComms || canDelete ? (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.full_name}`}
                          checked={selected.has(r.id)}
                          onChange={() => toggleOne(r.id)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">
                      <Link href={`/app/contacts/${r.id}`} className="hover:underline">{r.full_name}</Link>
                      {r.company ? <div className="text-xs text-muted-foreground">{r.company}</div> : null}
                      {r.agency_name || r.source ? (
                        <div className="text-[10px] text-muted-foreground">
                          {r.agency_name ? <span>{r.agency_name}</span> : null}
                          {r.agency_name && r.source ? <span> · </span> : null}
                          {r.source ? <span>{r.source}</span> : null}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">{CONTACT_TYPE_LABEL[r.contact_type] ?? r.contact_type}</TableCell>
                    <TableCell>
                      <SuppressionBadges view={sup} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.email ?? '—'}</TableCell>
                    <TableCell className="text-xs"><MonoLabel>{r.phone ?? '—'}</MonoLabel></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.tags.slice(0, 4).map((t) => (
                          <Badge key={t} variant="draft" className="text-[10px]">{t}</Badge>
                        ))}
                        {r.tags.length > 4 ? <span className="text-xs text-muted-foreground">+{r.tags.length - 4}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canManageComms ? (
                          individuallyBlocked ? (
                            <Button variant="ghost" size="icon" aria-label="Reactivate communications" disabled={busy === r.id} onClick={() => setBlock(r, 'active')}>
                              <CircleCheck className="h-4 w-4 text-emerald-600" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" aria-label="Block communications" disabled={busy === r.id} onClick={() => setBlock(r, 'blocked')}>
                              <Ban className="h-4 w-4" />
                            </Button>
                          )
                        ) : null}
                        {r.status === 'archived' ? (
                          <Button variant="ghost" size="icon" aria-label="Restore" disabled={busy === r.id} onClick={() => archive(r, 'active')}><ArchiveRestore className="h-4 w-4" /></Button>
                        ) : (
                          <Button variant="ghost" size="icon" aria-label="Archive" disabled={busy === r.id} onClick={() => archive(r, 'archived')}><Archive className="h-4 w-4" /></Button>
                        )}
                        {canDelete ? (
                          <Button variant="ghost" size="icon" aria-label="Delete permanently" disabled={busy === r.id} onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{filtered.length} contact{filtered.length === 1 ? '' : 's'} shown.</p>

      {/* Bulk block / unblock confirmation. */}
      <ModalShell
        open={bulkOpen !== null}
        onOpenChange={(o) => { if (!o) setBulkOpen(null) }}
        title={bulkOpen === 'blocked' ? 'Block communications for selected clients?' : 'Reactivate communications for selected clients?'}
        description={
          bulkOpen === 'blocked'
            ? `${selectedVisible.length} client${selectedVisible.length === 1 ? '' : 's'} will be excluded from applicable campaigns, marketing email, SMS, automated outreach, and AI-initiated communications. Transactional and requested servicing messages are unaffected.`
            : 'Restores business eligibility only. Any regulatory restriction (do-not-contact, unsubscribe, consent revocation) still applies and is not reactivated.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setBulkOpen(null)} disabled={bulkBusy}>Cancel</Button>
            <Button variant={bulkOpen === 'blocked' ? 'destructive' : 'default'} onClick={applyBulk} disabled={bulkBusy}>
              {bulkBusy ? 'Saving…' : bulkOpen === 'blocked' ? `Block ${selectedVisible.length}` : `Reactivate ${selectedVisible.length}`}
            </Button>
          </>
        }
      >
        {bulkOpen === 'blocked' ? (
          <Field id="bulk_suppression_reason" label="Reason" required>
            <Textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Why are you blocking these clients? (recorded in the audit log)" />
          </Field>
        ) : null}
      </ModalShell>

      {/* Permanent-delete confirmation — type-to-confirm, count shown, irreversible. */}
      <ModalShell
        open={deleteMode !== null}
        onOpenChange={(o) => { if (!o) { setDeleteMode(null); setDeleteConfirm('') } }}
        title="Permanently delete contacts?"
        description={
          deleteMode === 'filter'
            ? `This permanently removes ${filterCount === null ? '…' : filterCount} contact${filterCount === 1 ? '' : 's'} matching ${filterSummary}. This cannot be undone.`
            : `This permanently removes ${selectedVisible.length} selected contact${selectedVisible.length === 1 ? '' : 's'}. This cannot be undone.`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => { setDeleteMode(null); setDeleteConfirm('') }} disabled={deleteBusy}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteBusy || deleteConfirm.trim().toUpperCase() !== 'DELETE' || deleteTargetCount === 0 || (deleteMode === 'filter' && filterCount === null)}
            >
              {deleteBusy ? 'Deleting…' : `Delete ${deleteTargetCount} permanently`}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Deleting a contact removes it from the Contact Center for good. Any household, appointment, or
            opportunity that referenced it stays, with the reference detached. To keep a recoverable copy,
            archive instead.
          </p>
          <Field id="delete_confirm" label="Type DELETE to confirm" required>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm permanent deletion"
              autoComplete="off"
            />
          </Field>
        </div>
      </ModalShell>
    </div>
  )
}

/**
 * The three suppression layers rendered DISTINCTLY (spec: never as the same thing). Individual
 * and agent-level are BUSINESS suppression; DNC is a REGULATORY control shown separately.
 */
function SuppressionBadges({ view }: { view?: ContactSuppressionView }) {
  if (!view || (!view.individual && !view.agent && !view.dnc)) {
    return <Badge variant="active" className="text-[10px]">Active</Badge>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {view.individual ? (
        <Badge variant="blocked" className="text-[10px]" title="Individually blocked from outreach">Blocked</Badge>
      ) : null}
      {view.agent ? (
        <Badge variant="pending" className="text-[10px]" title="This client’s agent book is blocked from outreach">Agent blocked</Badge>
      ) : null}
      {view.dnc ? (
        <Badge variant="destructive" className="text-[10px]" title="Regulatory do-not-contact (STOP / unsubscribe / consent revoked)">Do Not Contact</Badge>
      ) : null}
    </div>
  )
}
