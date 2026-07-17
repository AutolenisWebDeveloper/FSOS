'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel } from '@/components/ui/typography'
import { EmptyState } from '@/components/archetypes'
import { patchJson, deleteJson, firstFieldError } from '@/lib/client/api'

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
}

export const CONTACT_TYPE_LABEL: Record<string, string> = {
  agency_owner: 'Agency Owner',
  client: 'Client',
  prospect: 'Prospect',
  term_conversion: 'Term Conversion',
  cross_sell: 'Cross-Sell',
  business: 'Business Owner',
  unknown: 'Uncategorized',
}

export function ContactList({ rows }: { rows: ContactRow[] }) {
  const router = useRouter()
  const [q, setQ] = React.useState('')
  const [type, setType] = React.useState('')
  const [showArchived, setShowArchived] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (!showArchived && r.status === 'archived') return false
      if (showArchived && r.status !== 'archived') return false
      if (type && r.contact_type !== type) return false
      if (!needle) return true
      return (
        r.full_name.toLowerCase().includes(needle) ||
        (r.email || '').toLowerCase().includes(needle) ||
        (r.phone || '').includes(needle) ||
        (r.company || '').toLowerCase().includes(needle) ||
        r.tags.some((t) => t.toLowerCase().includes(needle))
      )
    })
  }, [rows, q, type, showArchived])

  async function archive(r: ContactRow, next: 'active' | 'archived') {
    setBusy(r.id)
    const res = await patchJson(`/api/app/contacts/${r.id}`, { status: next })
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(next === 'archived' ? 'Contact archived.' : 'Contact restored.')
    router.refresh()
  }

  async function remove(r: ContactRow) {
    if (!window.confirm(`Delete ${r.full_name}? This cannot be undone from the UI.`)) return
    setBusy(r.id)
    const res = await deleteJson(`/api/app/contacts/${r.id}`)
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success('Contact deleted.')
    router.refresh()
  }

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
        <Button variant={showArchived ? 'default' : 'outline'} size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Viewing archived' : 'Active'}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No contacts" description={q || type ? 'No contacts match the current filters.' : 'Add a contact or import a file to get started.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <Link href={`/app/contacts/${r.id}`} className="hover:underline">{r.full_name}</Link>
                    {r.company ? <div className="text-xs text-muted-foreground">{r.company}</div> : null}
                  </TableCell>
                  <TableCell className="text-xs">{CONTACT_TYPE_LABEL[r.contact_type] ?? r.contact_type}</TableCell>
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
                      {r.status === 'archived' ? (
                        <Button variant="ghost" size="icon" aria-label="Restore" disabled={busy === r.id} onClick={() => archive(r, 'active')}><ArchiveRestore className="h-4 w-4" /></Button>
                      ) : (
                        <Button variant="ghost" size="icon" aria-label="Archive" disabled={busy === r.id} onClick={() => archive(r, 'archived')}><Archive className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" aria-label="Delete" disabled={busy === r.id} onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{filtered.length} contact{filtered.length === 1 ? '' : 's'} shown.</p>
    </div>
  )
}
