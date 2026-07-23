'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel } from '@/components/ui/typography'

interface RowResult {
  row_number: number
  agent_code: string | null
  owner_name: string | null
  email: string | null
  status: string
  agency_id: string | null
  error_message: string | null
}

interface UploadResult {
  filename: string
  total: number
  counts: { success: number; duplicate: number; invalid: number; failed: number }
  rows: RowResult[]
}

interface Batch {
  id: string
  filename: string | null
  stats: { total_rows?: number; success?: number; duplicate?: number; invalid?: number; failed?: number } | null
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  success: 'text-status-won',
  duplicate: 'text-muted-foreground',
  invalid: 'text-amber-600 dark:text-amber-500',
  failed: 'text-destructive',
}

export function AgencyImportForm() {
  const router = useRouter()
  const [file, setFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<UploadResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [batches, setBatches] = React.useState<Batch[]>([])

  const loadHistory = React.useCallback(async () => {
    try {
      const r = await fetch('/api/agencies/import?limit=15')
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
      const res = await fetch('/api/agencies/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Import failed (HTTP ${res.status}).`)
        return
      }
      setResult(data as UploadResult)
      const n = data.counts?.success ?? 0
      toast.success(`Imported ${n} of ${data.total} agencies.`)
      loadHistory()
      if (n > 0) router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload an agent directory</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <label
                htmlFor="agency-file"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:border-primary/50"
              >
                {file ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
                <span className="text-sm font-medium">{file ? file.name : 'Drop a CSV or Excel file here or click to browse'}</span>
                <span className="text-xs text-muted-foreground">CSV or .xlsx · max 5MB · up to 500 rows</span>
                <input
                  id="agency-file"
                  type="file"
                  accept=".csv,.xlsx"
                  className="sr-only"
                  onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="default_state">Default state</Label>
                  <Input id="default_state" name="default_state" defaultValue="TX" maxLength={2} className="uppercase" />
                  <p className="text-xs text-muted-foreground">Applied to rows with no state column. Editable — verify.</p>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={busy || !file}>
                {busy ? 'Importing…' : 'Import agencies'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Columns are recognized by header (agent code, first/last or name, address, city, zip, business phone, mobile, email,
                and the &ldquo;existing leads user&rdquo; / &ldquo;interested&rdquo; flags). A name and one identifier
                (agent code, email, or phone) are required per row. Duplicates — by agent code or email — are skipped.
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
                <span><strong>{result.counts.success}</strong> created</span>
                <span className="text-muted-foreground"><strong>{result.counts.duplicate}</strong> duplicate</span>
                <span className="text-muted-foreground"><strong>{result.counts.invalid}</strong> invalid</span>
                <span className={result.counts.failed ? 'text-destructive' : 'text-muted-foreground'}><strong>{result.counts.failed}</strong> failed</span>
                <span className="text-muted-foreground">of {result.total} rows</span>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Agent code</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.slice(0, 200).map((r) => (
                      <TableRow key={r.row_number}>
                        <TableCell><MonoLabel>{r.row_number}</MonoLabel></TableCell>
                        <TableCell><MonoLabel>{r.agent_code ?? '—'}</MonoLabel></TableCell>
                        <TableCell>
                          {r.agency_id ? (
                            <a className="font-medium underline-offset-2 hover:underline" href={`/app/agencies/${r.agency_id}`}>{r.owner_name || '—'}</a>
                          ) : (
                            r.owner_name || '—'
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.email ?? '—'}</TableCell>
                        <TableCell className={`capitalize ${STATUS_STYLES[r.status] ?? ''}`}>{r.status}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.error_message ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {result.rows.length > 200 ? <p className="text-xs text-muted-foreground">Showing the first 200 of {result.rows.length} rows.</p> : null}
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
          <CardTitle className="text-base">Import history</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No directory imports yet.</p>
          ) : (
            <ul className="space-y-3">
              {batches.map((b) => (
                <li key={b.id} className="border-b pb-3 text-sm last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{b.filename ?? 'directory'}</span>
                    <MonoLabel className="text-xs">{new Date(b.created_at).toLocaleDateString('en-US')}</MonoLabel>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {b.stats?.success ?? 0} created · {b.stats?.duplicate ?? 0} dup · {b.stats?.failed ?? 0} failed · of {b.stats?.total_rows ?? 0}
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
