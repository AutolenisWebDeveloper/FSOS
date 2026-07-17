'use client'

import * as React from 'react'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel } from '@/components/ui/typography'
import { CONTACT_TYPE_LABEL } from '@/components/app/ContactList'

interface RowResult {
  row_number: number
  full_name: string | null
  email: string | null
  phone: string | null
  status: string
  contact_type: string | null
  error_message: string | null
}
interface ImportResult {
  filename: string
  format: string
  total: number
  counts: { imported: number; duplicate: number; invalid: number }
  ai_used?: boolean
  detection_method?: string
  routing?: { enabled: boolean; ai_used: boolean; counts: Record<string, number>; capped: number }
  rows: RowResult[]
}

export function ContactImportForm({ aiAvailable }: { aiAvailable: boolean }) {
  const [file, setFile] = React.useState<File | null>(null)
  const [route, setRoute] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setResult(null)
    if (!file) return setError('Choose a CSV, TSV, Excel (.xlsx), or JSON file first.')
    const fd = new FormData(e.currentTarget)
    fd.set('file', file)
    setBusy(true)
    try {
      const res = await fetch('/api/app/contacts/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Import failed (HTTP ${res.status}).`)
        return
      }
      setResult(data as ImportResult)
      toast.success(`Imported ${data.counts?.imported ?? 0} of ${data.total} contacts.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Import contacts into App B</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <label htmlFor="import-file" className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:border-primary/50">
              {file ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
              <span className="text-sm font-medium">{file ? file.name : 'Drop a CSV, TSV, Excel, or JSON file here or click to browse'}</span>
              <span className="text-xs text-muted-foreground">CSV · TSV · .xlsx · JSON · max 5MB · up to 2,000 rows</span>
              <input id="import-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.json" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tags">Tags (comma-separated)</Label>
                <Input id="tags" name="tags" placeholder="event-2026, warm-lead" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source">Source</Label>
                <Input id="source" name="source" placeholder="import" />
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={route} onChange={(e) => setRoute(e.target.checked)} />
              <span>
                <span className="font-medium">AI categorize contacts</span>
                <span className="block text-xs text-muted-foreground">Identify each contact’s type and auto-tag it as it’s stored. Falls back to Uncategorized if the AI gateway is off.</span>
              </span>
            </label>

            <input type="hidden" name="ai" value={aiAvailable ? 'true' : 'false'} />
            <input type="hidden" name="ai_route" value={route ? 'true' : 'false'} />

            <Button type="submit" className="w-full" disabled={busy || !file}>{busy ? 'Importing…' : 'Import contacts'}</Button>
            <p className="text-xs text-muted-foreground">Columns are recognized automatically. A name and either email or phone are required per row. Duplicates (in-file and against existing contacts) are detected and skipped.</p>
          </form>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-status-won" /> {result.filename} · {result.format.toUpperCase()}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span><strong>{result.counts.imported}</strong> imported</span>
              <span className="text-muted-foreground"><strong>{result.counts.duplicate}</strong> duplicate</span>
              <span className="text-muted-foreground"><strong>{result.counts.invalid}</strong> invalid</span>
              <span className="text-muted-foreground">of {result.total} rows</span>
              {result.ai_used ? <span className="text-muted-foreground">· columns via {result.detection_method}</span> : null}
            </div>
            {result.routing?.enabled && Object.keys(result.routing.counts).length > 0 ? (
              <div className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">Categorization {result.routing.ai_used ? <span className="text-xs font-normal text-muted-foreground">· AI</span> : <span className="text-xs font-normal text-muted-foreground">· rules only</span>}</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(result.routing.counts).map(([type, n]) => (
                    <span key={type} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"><strong>{n}</strong> {CONTACT_TYPE_LABEL[type] ?? type}</span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Contact</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
                <TableBody>
                  {result.rows.slice(0, 200).map((r) => (
                    <TableRow key={r.row_number}>
                      <TableCell><MonoLabel>{r.row_number}</MonoLabel></TableCell>
                      <TableCell>{r.full_name || r.email || r.phone || '—'}</TableCell>
                      <TableCell className="text-xs">{r.contact_type ? (CONTACT_TYPE_LABEL[r.contact_type] ?? r.contact_type) : '—'}</TableCell>
                      <TableCell className="capitalize">{r.status}</TableCell>
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
          <div><p className="font-medium">Something went wrong</p><p className="text-muted-foreground">{error}</p></div>
        </div>
      ) : null}
    </div>
  )
}
