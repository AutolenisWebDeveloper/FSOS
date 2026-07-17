'use client'

import * as React from 'react'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel } from '@/components/ui/typography'

interface PipelineOption {
  key: string
  name: string
  stages: { position: number; name: string }[]
}

interface RowResult {
  row_number: number
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  status: string
  error_message: string | null
}

interface UploadResult {
  filename: string
  total: number
  counts: { success: number; duplicate: number; invalid: number; failed: number }
  ai_used?: boolean
  detection_method?: string
  rows: RowResult[]
}

interface Batch {
  batch_id: string
  filename: string
  source: string | null
  total_rows: number | null
  success_count: number | null
  duplicate_count: number | null
  invalid_count: number | null
  failed_count: number | null
  status: string
  created_at: string
}

export function ContactUploadForm({ pipelines, aiAvailable }: { pipelines: PipelineOption[]; aiAvailable: boolean }) {
  const [file, setFile] = React.useState<File | null>(null)
  const [pipelineKey, setPipelineKey] = React.useState('')
  const [stage, setStage] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<UploadResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [batches, setBatches] = React.useState<Batch[]>([])
  const formRef = React.useRef<HTMLFormElement>(null)

  const stages = pipelines.find((p) => p.key === pipelineKey)?.stages ?? []

  const loadHistory = React.useCallback(async () => {
    try {
      const r = await fetch('/api/app/contacts/upload?limit=15')
      const d = await r.json().catch(() => ({}))
      if (r.ok) setBatches(d.batches || [])
    } catch {
      /* history is best-effort */
    }
  }, [])

  React.useEffect(() => {
    loadHistory()
  }, [loadHistory])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setResult(null)
    if (!file) {
      setError('Choose a CSV or Excel (.xlsx) file first.')
      return
    }
    const fd = new FormData(e.currentTarget)
    fd.set('file', file)
    setBusy(true)
    try {
      const res = await fetch('/api/app/contacts/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.reason === 'not_configured') {
          setError('GoHighLevel isn’t configured yet (set GHL_API_KEY).')
        } else {
          setError(data.error || `Upload failed (HTTP ${res.status}).`)
        }
        return
      }
      setResult(data as UploadResult)
      toast.success(`Imported ${data.counts?.success ?? 0} of ${data.total} contacts.`)
      loadHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload contacts to GoHighLevel</CardTitle>
          </CardHeader>
          <CardContent>
            <form ref={formRef} onSubmit={submit} className="space-y-4">
              <label
                htmlFor="contact-file"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:border-primary/50"
              >
                {file ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
                <span className="text-sm font-medium">{file ? file.name : 'Drop a CSV or Excel file here or click to browse'}</span>
                <span className="text-xs text-muted-foreground">CSV or .xlsx · max 5MB · up to 1,000 rows</span>
                <input
                  id="contact-file"
                  type="file"
                  accept=".csv,.xlsx"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tags">Tags (comma-separated)</Label>
                  <Input id="tags" name="tags" placeholder="apex-import, warm-lead" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source">Source</Label>
                  <Input id="source" name="source" defaultValue="csv_upload" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="agency_owner">Agency owner (optional)</Label>
                <Input id="agency_owner" name="agency_owner" placeholder="Referring agency owner — applied when a row has no Agency Owner column" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pipeline">Pipeline (optional)</Label>
                  <Select
                    id="pipeline"
                    name="pipeline"
                    value={pipelineKey}
                    onChange={(e) => {
                      setPipelineKey(e.target.value)
                      setStage('')
                    }}
                  >
                    <option value="">— No opportunity (contacts only) —</option>
                    {pipelines.map((p) => (
                      <option key={p.key} value={p.key}>{p.name}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stage">Stage</Label>
                  <Select id="stage" name="stage" value={stage} onChange={(e) => setStage(e.target.value)} disabled={!pipelineKey}>
                    <option value="">—</option>
                    {stages.map((s) => (
                      <option key={s.position} value={s.position}>{s.position}. {s.name}</option>
                    ))}
                  </Select>
                </div>
              </div>

              <input type="hidden" name="ai" value={aiAvailable ? 'true' : 'false'} />

              <Button type="submit" className="w-full" disabled={busy || !file}>
                {busy ? 'Importing…' : 'Import & sync to GoHighLevel'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Columns are recognized by exact header, {aiAvailable ? 'AI header/value analysis, ' : ''}then value patterns. A name (full, or first + last) and either email or phone are required.
              </p>
            </form>
          </CardContent>
        </Card>

        {result ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-status-won" /> Import result — {result.filename}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <span><strong>{result.counts.success}</strong> imported</span>
                <span className="text-muted-foreground"><strong>{result.counts.duplicate}</strong> duplicate</span>
                <span className="text-muted-foreground"><strong>{result.counts.invalid}</strong> invalid</span>
                <span className={result.counts.failed ? 'text-destructive' : 'text-muted-foreground'}><strong>{result.counts.failed}</strong> failed</span>
                <span className="text-muted-foreground">of {result.total} rows</span>
                {result.ai_used ? <span className="text-muted-foreground">· columns via {result.detection_method}</span> : null}
              </div>
              {result.rows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.rows.map((r) => (
                        <TableRow key={r.row_number}>
                          <TableCell><MonoLabel>{r.row_number}</MonoLabel></TableCell>
                          <TableCell>{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || r.phone || '—'}</TableCell>
                          <TableCell className="capitalize">{r.status}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.error_message ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Every row imported cleanly.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              <p className="font-medium">Something went wrong</p>
              <p className="text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : null}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Upload history</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <ul className="space-y-3">
              {batches.map((b) => (
                <li key={b.batch_id} className="border-b pb-3 text-sm last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{b.filename}</span>
                    <MonoLabel className="text-xs">{new Date(b.created_at).toLocaleDateString('en-US')}</MonoLabel>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {b.success_count ?? 0} imported · {b.duplicate_count ?? 0} dup · {b.failed_count ?? 0} failed · of {b.total_rows ?? 0}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
