'use client'

import * as React from 'react'
import { FileSpreadsheet, Upload, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel } from '@/components/ui/typography'

interface Plan {
  serving_agents: { in_file: number; existing: number; new: number }
  households: { in_file: number; existing: number; new: number }
  policies: { in_file: number; existing: number; new: number }
}
interface Summary {
  policies: number
  skipped: number
  serving_agents: number
  households: number
  securities: number
  active: number
  term_products: number
  by_status: Record<string, number>
}
interface PreviewData {
  mode: 'preview'
  filename: string
  summary: Summary
  plan: Plan
  sample: Array<{ policy_number: string; product_name: string; status: string; is_security: boolean; owner_name: string; serving_agent_name: string | null }>
}
interface CommitData {
  mode: 'commit'
  committed: { agencies_new: number; households_new: number; members_added: number; policies_added: number }
  plan: Plan
}

export function BookImportWizard() {
  const [file, setFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'commit' | null>(null)
  const [preview, setPreview] = React.useState<PreviewData | null>(null)
  const [committed, setCommitted] = React.useState<CommitData | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function run(mode: 'preview' | 'commit') {
    if (!file) return setError('Choose the FNWL .xlsx export first.')
    setError(null)
    if (mode === 'preview') setCommitted(null)
    setBusy(mode)
    const fd = new FormData()
    fd.set('file', file)
    fd.set('mode', mode)
    try {
      const res = await fetch('/api/app/book/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Request failed (HTTP ${res.status}).`)
        return
      }
      if (mode === 'preview') {
        setPreview(data as PreviewData)
      } else {
        setCommitted(data as CommitData)
        toast.success(`Imported ${data.committed.policies_added} policies.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Upload the FNWL in-force review (.xlsx)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <label htmlFor="book-file" className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:border-primary/50">
              {file ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
              <span className="text-sm font-medium">{file ? file.name : 'Drop the FNWL Review of in-force business (.xlsx)'}</span>
              <span className="text-xs text-muted-foreground">The confidentiality header and blank rows are handled automatically.</span>
              <input id="book-file" type="file" accept=".xlsx" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setCommitted(null) }} />
            </label>
            <div className="flex gap-2">
              <Button onClick={() => run('preview')} disabled={busy !== null || !file}>{busy === 'preview' ? 'Analyzing…' : 'Preview (dry run)'}</Button>
              <Button variant="outline" onClick={() => run('commit')} disabled={busy !== null || !preview}>{busy === 'commit' ? 'Importing…' : 'Commit import'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Preview parses and counts without writing. Commit is idempotent — re-running never duplicates. Variable products are flagged as securities and excluded from automated outreach.</p>
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
              <Stat label="Policies" value={preview.summary.policies} />
              <Stat label="Serving agents" value={preview.summary.serving_agents} />
              <Stat label="Households" value={preview.summary.households} />
              <Stat label="Active" value={preview.summary.active} />
            </div>
            {preview.summary.securities > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-status-security/40 bg-status-security/5 p-2 text-xs text-status-security">
                <ShieldAlert className="h-4 w-4" /> {preview.summary.securities} variable-product policies will be flagged as securities (excluded from automated outreach).
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>Entity</TableHead><TableHead className="text-right">In file</TableHead><TableHead className="text-right">Already exists</TableHead><TableHead className="text-right">Will add</TableHead></TableRow></TableHeader>
                <TableBody>
                  <PlanRow label="Agency partnerships" p={preview.plan.serving_agents} />
                  <PlanRow label="Households" p={preview.plan.households} />
                  <PlanRow label="Policies" p={preview.plan.policies} />
                </TableBody>
              </Table>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Sample (first {preview.sample.length})</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Product</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead><TableHead>Serving agent</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.sample.map((s) => (
                      <TableRow key={s.policy_number}>
                        <TableCell><MonoLabel>{s.policy_number}</MonoLabel></TableCell>
                        <TableCell className="text-xs">{s.product_name}{s.is_security ? <span className="ml-1 text-status-security">◆</span> : null}</TableCell>
                        <TableCell className="text-xs capitalize">{s.status}</TableCell>
                        <TableCell className="text-xs">{s.owner_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.serving_agent_name ?? '—'}</TableCell>
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
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-status-won" /> Import committed</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Agencies added" value={committed.committed.agencies_new} />
              <Stat label="Households added" value={committed.committed.households_new} />
              <Stat label="Members added" value={committed.committed.members_added} />
              <Stat label="Policies added" value={committed.committed.policies_added} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Re-running the same file adds nothing further (idempotent).</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold leading-none">{value.toLocaleString('en-US')}</div>
    </div>
  )
}

function PlanRow({ label, p }: { label: string; p: { in_file: number; existing: number; new: number } }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right">{p.in_file.toLocaleString('en-US')}</TableCell>
      <TableCell className="text-right text-muted-foreground">{p.existing.toLocaleString('en-US')}</TableCell>
      <TableCell className="text-right font-medium">{p.new.toLocaleString('en-US')}</TableCell>
    </TableRow>
  )
}
