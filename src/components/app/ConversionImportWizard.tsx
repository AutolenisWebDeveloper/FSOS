'use client'

import * as React from 'react'
import { FileSpreadsheet, Upload, AlertTriangle, CheckCircle2, CalendarClock, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel, Money } from '@/components/ui/typography'

interface Summary {
  total: number
  with_owner: number
  with_insured: number
  with_deadline: number
  total_convertible: number
  expiring_12mo: number
  by_product: Record<string, number>
}
interface Plan {
  total_rows: number
  skipped_rows: number
  policies_matched: number
  policies_unmatched: number
  deadlines_to_set: number
  contacts_to_tag: number
}
interface SampleRow {
  policy_number: string
  owner: string
  insured: string | null
  product: string | null
  convertible_amount: number | null
  conversion_deadline: string | null
  matched: boolean
}
interface PreviewData { mode: 'preview'; filename: string; summary: Summary; plan: Plan; unmatched: string[]; sample: SampleRow[] }
interface CommitData { mode: 'commit'; filename: string; summary: Summary; plan: Plan; committed: { policies_enriched: number; contacts_created: number; contacts_tagged: number; members_added: number } }

export function ConversionImportWizard({ today }: { today: string }) {
  const [file, setFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'commit' | null>(null)
  const [preview, setPreview] = React.useState<PreviewData | null>(null)
  const [committed, setCommitted] = React.useState<CommitData | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function run(mode: 'preview' | 'commit') {
    if (!file) return setError('Choose the conversion export (XLSX, CSV, or PDF) first.')
    setError(null)
    if (mode === 'preview') setCommitted(null)
    setBusy(mode)
    const fd = new FormData()
    fd.set('file', file)
    fd.set('mode', mode)
    fd.set('now', today)
    try {
      const res = await fetch('/api/app/conversions/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Request failed (HTTP ${res.status}).`); return }
      if (mode === 'preview') setPreview(data as PreviewData)
      else { setCommitted(data as CommitData); toast.success(`Set ${data.committed.policies_enriched} conversion deadlines.`) }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
    } finally {
      setBusy(null)
    }
  }

  const topProducts = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Upload the Life Conversion Opportunities list</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <label htmlFor="conv-file" className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:border-primary/50">
              {file ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
              <span className="text-sm font-medium">{file ? file.name : 'Drop the conversion export (.xlsx, .csv, or .pdf)'}</span>
              <span className="text-xs text-muted-foreground">Each policy is matched by policy number and its conversion deadline is set on the book — no valid data overwritten.</span>
              <input id="conv-file" type="file" accept=".xlsx,.csv,.tsv,.txt,.pdf,.json" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setCommitted(null) }} />
            </label>
            <div className="flex gap-2">
              <Button onClick={() => run('preview')} disabled={busy !== null || !file}>{busy === 'preview' ? 'Analyzing…' : 'Preview (dry run)'}</Button>
              <Button variant="outline" onClick={() => run('commit')} disabled={busy !== null || !preview}>{busy === 'commit' ? 'Syncing…' : 'Commit sync'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Matches each row to a book policy by policy number, sets the conversion deadline (only when blank), tags the owner contact <span className="font-medium">term-conversion</span>, and records the named insured. Term products only — nothing here is a security. Re-running is idempotent.</p>
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
              <Stat label="Conversion policies" value={preview.summary.total} />
              <Stat label="Match the book" value={preview.plan.policies_matched} icon={<Link2 className="h-3.5 w-3.5" />} />
              <Stat label="Deadlines to set" value={preview.plan.deadlines_to_set} icon={<CalendarClock className="h-3.5 w-3.5" />} />
              <Stat label="Convertible" money value={preview.summary.total_convertible} />
            </div>

            {preview.summary.expiring_12mo > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-status-pending/40 bg-status-pending/5 p-2 text-xs">
                <CalendarClock className="h-4 w-4 text-status-pending" />
                {preview.summary.expiring_12mo} conversion window{preview.summary.expiring_12mo === 1 ? '' : 's'} close within 12 months — prioritize these.
              </div>
            ) : null}
            {preview.plan.policies_unmatched > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                {preview.plan.policies_unmatched} policies aren&apos;t in the book yet (import the District Book first): {preview.unmatched.join(', ')}
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-sm font-medium">Products</p>
              <div className="flex flex-wrap gap-1">
                {topProducts(preview.summary.by_product).map(([p, n]) => (
                  <Badge key={p} variant="draft" className="text-[10px]">{p} · {n}</Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Sample (first {preview.sample.length})</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Owner</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Convertible</TableHead><TableHead>Deadline</TableHead><TableHead>Match</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.sample.map((s) => (
                      <TableRow key={s.policy_number}>
                        <TableCell><MonoLabel>{s.policy_number}</MonoLabel></TableCell>
                        <TableCell className="text-xs">{s.owner}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.product ?? '—'}</TableCell>
                        <TableCell className="text-right"><Money value={s.convertible_amount} /></TableCell>
                        <TableCell className="text-xs">{s.conversion_deadline ?? '—'}</TableCell>
                        <TableCell>{s.matched ? <Badge variant="active" className="text-[9px]">book</Badge> : <Badge variant="draft" className="text-[9px]">new</Badge>}</TableCell>
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
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-status-won" /> Conversion sync committed</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Deadlines set" value={committed.committed.policies_enriched} />
              <Stat label="Contacts tagged" value={committed.committed.contacts_tagged} />
              <Stat label="Contacts created" value={committed.committed.contacts_created} />
              <Stat label="Insureds added" value={committed.committed.members_added} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Conversion deadlines are now on the book and drive the Term Conversion pipeline. Re-running the same file changes nothing further (idempotent).</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Stat({ label, value, icon, money }: { label: string; value: number; icon?: React.ReactNode; money?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-semibold leading-none">{money ? <Money value={value} /> : value.toLocaleString('en-US')}</div>
    </div>
  )
}
