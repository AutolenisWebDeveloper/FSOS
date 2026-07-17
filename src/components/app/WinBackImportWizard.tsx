'use client'

import * as React from 'react'
import Link from 'next/link'
import { FileSpreadsheet, Upload, AlertTriangle, CheckCircle2, Users, Link2, ClipboardCheck, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Summary {
  total: number
  had_life: number
  with_phone: number
  with_email: number
  with_state: number
  dnc: number
  email_unsub: number
  by_inactive_lob: Record<string, number>
  by_state: Record<string, number>
}
interface Plan {
  total_rows: number
  skipped_rows: number
  had_life: number
  matched_merge: number
  needs_review: number
  new_contacts: number
  duplicate_rows_in_file: number
  owner_agency: string | null
}
interface SampleRow {
  full_name: string
  inactive_lob: string[]
  active_lob: string[]
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  had_life: boolean
  dnc: boolean
  email_unsub: boolean
  action: 'merge' | 'review' | 'create'
  confidence: string
  matched_by: string[]
}
interface PreviewData { mode: 'preview'; filename: string; summary: Summary; plan: Plan; sample: SampleRow[] }
interface CommitData { mode: 'commit'; filename: string; summary: Summary; plan: Plan; committed: { contacts_created: number; contacts_enriched: number; queued_for_review: number } }
interface Agency { id: string; agency_name: string | null; owner_name?: string | null }

const ACTION_LABEL: Record<SampleRow['action'], { label: string; variant: 'active' | 'draft' | 'pending' }> = {
  merge: { label: 'enrich', variant: 'active' },
  create: { label: 'new', variant: 'draft' },
  review: { label: 'review', variant: 'pending' },
}

export function WinBackImportWizard() {
  const [file, setFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'commit' | null>(null)
  const [preview, setPreview] = React.useState<PreviewData | null>(null)
  const [committed, setCommitted] = React.useState<CommitData | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [agencies, setAgencies] = React.useState<Agency[]>([])
  const [ownerId, setOwnerId] = React.useState<string>('')

  // Load agency partnerships once for the book-of-business owner selector.
  React.useEffect(() => {
    let active = true
    fetch('/api/agencies')
      .then((r) => (r.ok ? r.json() : { agencies: [] }))
      .then((d) => { if (active) setAgencies((d.agencies || []) as Agency[]) })
      .catch(() => { if (active) setAgencies([]) })
    return () => { active = false }
  }, [])

  async function run(mode: 'preview' | 'commit') {
    if (!file) return setError('Choose the win-back list (PDF, CSV, XLSX, or JSON) first.')
    setError(null)
    if (mode === 'preview') setCommitted(null)
    setBusy(mode)
    const fd = new FormData()
    fd.set('file', file)
    fd.set('mode', mode)
    if (ownerId) fd.set('agency_partnership_id', ownerId)
    try {
      const res = await fetch('/api/app/winback/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Request failed (HTTP ${res.status}).`); return }
      if (mode === 'preview') {
        setPreview(data as PreviewData)
      } else {
        setCommitted(data as CommitData)
        toast.success(`Created ${data.committed.contacts_created}, enriched ${data.committed.contacts_enriched}, ${data.committed.queued_for_review} to review.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
    } finally {
      setBusy(null)
    }
  }

  const topLobs = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const ownerName = agencies.find((a) => a.id === ownerId)?.agency_name || null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Upload the Win-Back Life list</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wb-owner" className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Book-of-business owner (optional)</Label>
              <Select id="wb-owner" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPreview(null); setCommitted(null) }} disabled={busy !== null}>
                <option value="">— No owner assignment —</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>{a.agency_name || a.owner_name || a.id}</option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">If this list is one agent/agency&apos;s book, select them and every imported contact will be linked to that partnership — without overwriting a contact that already belongs to someone else.</p>
            </div>

            <label htmlFor="wb-file" className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:border-primary/50">
              {file ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
              <span className="text-sm font-medium">{file ? file.name : 'Drop the win-back export (.pdf, .csv, .xlsx, or .json)'}</span>
              <span className="text-xs text-muted-foreground">Each row is matched to an existing contact and enriched — no duplicates, no overwriting valid data. Ambiguous matches are queued for review, never guessed.</span>
              <input id="wb-file" type="file" accept=".pdf,.csv,.tsv,.txt,.xlsx,.json" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setCommitted(null) }} />
            </label>

            <div className="flex gap-2">
              <Button onClick={() => run('preview')} disabled={busy !== null || !file}>{busy === 'preview' ? 'Analyzing…' : 'Preview (dry run)'}</Button>
              <Button variant="outline" onClick={() => run('commit')} disabled={busy !== null || !preview}>{busy === 'commit' ? 'Syncing…' : 'Commit sync'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Matched by win-back key → email → phone → name + ZIP with the shared resolver. Merges fill blank fields only and union tags &amp; lines of business — existing data is never overwritten. DNC / unsubscribed flags are preserved. Re-running is idempotent.</p>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
          <div><p className="font-medium">Something went wrong</p><p className="text-muted-foreground">{error}</p></div>
        </div>
      ) : null}

      {preview ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Preview — {preview.filename}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Records" value={preview.summary.total} />
              <Stat label="Had life (win-back)" value={preview.summary.had_life} />
              <Stat label="With phone" value={preview.summary.with_phone} />
              <Stat label="With email" value={preview.summary.with_email} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Will enrich" value={preview.plan.matched_merge} icon={<Link2 className="h-3.5 w-3.5" />} />
              <Stat label="New contacts" value={preview.plan.new_contacts} icon={<Users className="h-3.5 w-3.5" />} />
              <Stat label="Needs review" value={preview.plan.needs_review} icon={<ClipboardCheck className="h-3.5 w-3.5" />} />
              <Stat label="Dupes in file" value={preview.plan.duplicate_rows_in_file} />
            </div>

            {preview.plan.owner_agency ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
                <Building2 className="h-4 w-4 text-primary" />
                Book-of-business owner: <span className="font-medium">{preview.plan.owner_agency}</span> — imported contacts will be linked to this partnership.
              </div>
            ) : null}

            {(preview.summary.dnc > 0 || preview.summary.email_unsub > 0) ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-pending/40 bg-status-pending/5 p-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-status-pending" />
                Compliance flags preserved: {preview.summary.dnc} do-not-call / revoked, {preview.summary.email_unsub} email-unsubscribed.
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-sm font-medium">Inactive agency lines</p>
              <div className="flex flex-wrap gap-1">
                {topLobs(preview.summary.by_inactive_lob).map(([lob, n]) => (
                  <Badge key={lob} variant="draft" className="text-[10px]">{lob} · {n.toLocaleString('en-US')}</Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Sample (first {preview.sample.length})</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Inactive lines</TableHead><TableHead>State</TableHead><TableHead>Contact</TableHead><TableHead>Match</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.sample.map((s, i) => {
                      const a = ACTION_LABEL[s.action]
                      return (
                        <TableRow key={`${s.full_name}-${i}`}>
                          <TableCell className="text-xs font-medium">{s.full_name}</TableCell>
                          <TableCell className="text-xs">{s.inactive_lob.join(', ') || '—'}{s.had_life ? <Badge variant="active" className="ml-1 text-[9px]">life</Badge> : null}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{s.state || '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {s.email || s.phone || '—'}
                            {s.dnc ? <Badge variant="draft" className="ml-1 text-[9px]">DNC</Badge> : null}
                            {s.email_unsub ? <Badge variant="draft" className="ml-1 text-[9px]">unsub</Badge> : null}
                          </TableCell>
                          <TableCell className="text-xs"><Badge variant={a.variant} className="text-[9px]">{a.label}</Badge></TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {ownerName && !preview.plan.owner_agency ? (
              <p className="text-xs text-muted-foreground">Owner {ownerName} will be applied on commit.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {committed ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-status-won" /> Win-back sync committed</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Contacts created" value={committed.committed.contacts_created} />
              <Stat label="Contacts enriched" value={committed.committed.contacts_enriched} />
              <Stat label="Queued for review" value={committed.committed.queued_for_review} />
              <Stat label="Records processed" value={committed.plan.total_rows} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Existing profiles were merged in place — no valid data overwritten. Re-running the same file adds nothing further (idempotent).</p>
            {committed.committed.queued_for_review > 0 ? (
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href="/app/contacts/review"><ClipboardCheck className="mr-1.5 h-4 w-4" /> Resolve {committed.committed.queued_for_review} in Import Review</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-semibold leading-none">{value.toLocaleString('en-US')}</div>
    </div>
  )
}
