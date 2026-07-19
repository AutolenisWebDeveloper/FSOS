'use client'

import * as React from 'react'
import { FileSpreadsheet, Upload, AlertTriangle, CheckCircle2, Users, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Summary {
  total: number
  with_phone: number
  with_email: number
  with_address: number
  dnc: number
  email_unsub: number
  by_lob: Record<string, number>
  by_state: Record<string, number>
}
interface Plan {
  total_rows: number
  skipped_rows: number
  matched: number
  new_contacts: number
  enrich_updates: number
  duplicate_rows_in_file: number
}
interface SampleRow {
  full_name: string
  lines_of_business: string[]
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  matched: boolean
  dnc: boolean
  email_unsub: boolean
}
interface PreviewData { mode: 'preview'; filename: string; summary: Summary; plan: Plan; sample: SampleRow[] }
interface CommitData { mode: 'commit'; filename: string; summary: Summary; plan: Plan; committed: { contacts_created: number; contacts_enriched: number } }

export function CrossSellImportWizard() {
  const [file, setFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'commit' | null>(null)
  const [preview, setPreview] = React.useState<PreviewData | null>(null)
  const [committed, setCommitted] = React.useState<CommitData | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function run(mode: 'preview' | 'commit') {
    if (!file) return setError('Choose the cross-sell export (CSV, XLSX, or JSON) first.')
    setError(null)
    if (mode === 'preview') setCommitted(null)
    setBusy(mode)
    const fd = new FormData()
    fd.set('file', file)
    fd.set('mode', mode)
    try {
      const res = await fetch('/api/app/crosssell/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Request failed (HTTP ${res.status}).`)
        return
      }
      if (mode === 'preview') {
        setPreview(data as PreviewData)
      } else {
        setCommitted(data as CommitData)
        toast.success(`Created ${data.committed.contacts_created}, enriched ${data.committed.contacts_enriched}.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
    } finally {
      setBusy(null)
    }
  }

  const topLobs = (m: Record<string, number>) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Upload the cross-sell list (Auto/Home/Umbrella, No Life)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <label htmlFor="xs-file" className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:border-primary/50">
              {file ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
              <span className="text-sm font-medium">{file ? file.name : 'Drop the cross-sell export (.pdf, .csv, .xlsx, or .json)'}</span>
              <span className="text-xs text-muted-foreground">Salesforce printable-view PDFs are reconstructed automatically. The system matches each row to an existing contact and enriches it — no duplicates, no overwriting valid data.</span>
              <input id="xs-file" type="file" accept=".pdf,.csv,.tsv,.txt,.xlsx,.json" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setCommitted(null) }} />
            </label>
            <div className="flex gap-2">
              <Button onClick={() => run('preview')} disabled={busy !== null || !file}>{busy === 'preview' ? 'Analyzing…' : 'Preview (dry run)'}</Button>
              <Button variant="outline" onClick={() => run('commit')} disabled={busy !== null || !preview}>{busy === 'commit' ? 'Syncing…' : 'Commit sync'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Matched by cross-sell key → email → phone → name + ZIP. Merges fill blank fields only and union tags &amp; lines of business — existing data is never overwritten. DNC / unsubscribed flags are preserved. Re-running is idempotent.</p>
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
              <Stat label="With phone" value={preview.summary.with_phone} />
              <Stat label="With email" value={preview.summary.with_email} />
              <Stat label="Full address" value={preview.summary.with_address} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Match existing" value={preview.plan.matched} icon={<Link2 className="h-3.5 w-3.5" />} />
              <Stat label="New contacts" value={preview.plan.new_contacts} icon={<Users className="h-3.5 w-3.5" />} />
              <Stat label="Will enrich" value={preview.plan.enrich_updates} />
              <Stat label="Dupes in file" value={preview.plan.duplicate_rows_in_file} />
            </div>

            {(preview.summary.dnc > 0 || preview.summary.email_unsub > 0) ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-pending/40 bg-status-pending/5 p-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-status-pending" />
                Compliance flags preserved: {preview.summary.dnc} do-not-call / revoked, {preview.summary.email_unsub} email-unsubscribed.
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-sm font-medium">Lines of business</p>
              <div className="flex flex-wrap gap-1">
                {topLobs(preview.summary.by_lob).map(([lob, n]) => (
                  <Badge key={lob} variant="draft" className="text-[10px]">{lob} · {n.toLocaleString('en-US')}</Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Sample (first {preview.sample.length})</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Lines</TableHead><TableHead>City / State</TableHead><TableHead>Contact</TableHead><TableHead>Match</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.sample.map((s, i) => (
                      <TableRow key={`${s.full_name}-${i}`}>
                        <TableCell className="text-xs font-medium">{s.full_name}</TableCell>
                        <TableCell className="text-xs">{s.lines_of_business.join(', ') || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{[s.city, s.state].filter(Boolean).join(', ') || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.email || s.phone || '—'}
                          {s.dnc ? <Badge variant="draft" className="ml-1 text-[9px]">DNC</Badge> : null}
                          {s.email_unsub ? <Badge variant="draft" className="ml-1 text-[9px]">unsub</Badge> : null}
                        </TableCell>
                        <TableCell className="text-xs">{s.matched ? <Badge variant="active" className="text-[9px]">enrich</Badge> : <Badge variant="draft" className="text-[9px]">new</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {committed ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-status-won" /> Cross-sell sync committed</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Contacts created" value={committed.committed.contacts_created} />
              <Stat label="Contacts enriched" value={committed.committed.contacts_enriched} />
              <Stat label="Records processed" value={committed.plan.total_rows} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Existing profiles were merged in place — no valid data overwritten. Re-running the same file adds nothing further (idempotent).</p>
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
