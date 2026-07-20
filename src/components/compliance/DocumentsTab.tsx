'use client'

// Documents tab — the document processing queue + split-pane review workspace for the
// Compliance Intelligence module. Upload files, watch them move through the pipeline
// stages, then open a document to review the ORIGINAL (signed-URL preview) beside the
// EXTRACTED per-page text, search within the document, (re)process, structure a
// RightBridge report, or delete. Every extracted fact keeps its source page number.

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DocumentUpload, type UploadedDoc } from './DocumentUpload'
import { RefreshCw, RotateCw, Layers, Trash2, FileSearch } from 'lucide-react'

interface UploadRow {
  id: string
  case_id: string | null
  kind: string
  filename: string
  content_type: string | null
  size_bytes: number
  status: string
  extraction_method: string
  page_count: number
  char_count: number
  extraction_confidence: number | null
  low_confidence: boolean
  error: string | null
  report_id?: string | null
  url: string | null
  created_at: string
}

interface PageRow {
  page_number: number
  text: string
  char_count: number
  low_confidence: boolean
}

const KINDS = [
  'rightbridge', 'nigo', 'form', 'disclosure', 'statement', 'illustration', 'contract', 'supporting', 'other',
]

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded', secured: 'Secured', extracting: 'Extracting', extracted: 'Text extracted',
  structuring: 'Structuring', analyzed: 'Analysis ready', needs_review: 'Needs review', failed: 'Failed',
}

function statusVariant(status: string): 'won' | 'pending' | 'blocked' | 'assumption' | 'outline' {
  if (status === 'analyzed' || status === 'extracted') return 'won'
  if (status === 'needs_review') return 'assumption'
  if (status === 'failed') return 'blocked'
  return 'pending'
}

function fmtBytes(n: number): string {
  if (!n) return '—'
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentsTab() {
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('rightbridge')
  const [selected, setSelected] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/compliance/upload')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setError(json?.error || 'Failed to load documents')
      else setUploads(json.uploads ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onUploaded = useCallback(
    (doc: UploadedDoc) => {
      void refresh()
      setSelected(doc.id)
    },
    [refresh],
  )

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div>
          <h3 className="mb-1 text-sm font-semibold">Upload documents</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            RightBridge reports, NIGO notices, forms, disclosures, statements, illustrations, contracts — the whole
            multi-page PDF. Scanned PDFs and images fall back to model-vision OCR and are flagged for your review.
          </p>
          <div className="mb-3">
            <label htmlFor="doc-kind" className="mb-1 block text-xs font-medium">
              Document type
            </label>
            <select
              id="doc-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <DocumentUpload kind={kind} onUploaded={onUploaded} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Processing queue</h3>
        <Button variant="outline" size="sm" onClick={() => refresh()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : uploads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet. Upload a RightBridge PDF or a NIGO notice above.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Document</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Pages</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {uploads.map((u) => (
                <tr key={u.id} className={selected === u.id ? 'bg-primary/5' : undefined}>
                  <td className="px-3 py-2">
                    <div className="max-w-[240px] truncate font-medium">{u.filename}</div>
                    <div className="text-xs text-muted-foreground">{fmtBytes(u.size_bytes)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{u.kind.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(u.status)}>{STATUS_LABEL[u.status] ?? u.status}</Badge>
                    {u.error ? <div className="mt-1 max-w-[200px] truncate text-xs text-destructive" title={u.error}>{u.error}</div> : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{u.page_count || '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{u.extraction_method.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {u.extraction_confidence != null ? `${Math.round(u.extraction_confidence * 100)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelected(selected === u.id ? null : u.id)}>
                      <FileSearch className="mr-1 h-3.5 w-3.5" aria-hidden />
                      {selected === u.id ? 'Close' : 'Review'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? <DocumentDetail uploadId={selected} onChanged={refresh} /> : null}
    </div>
  )
}

function DocumentDetail({ uploadId, onChanged }: { uploadId: string; onChanged: () => void }) {
  const [upload, setUpload] = useState<UploadRow | null>(null)
  const [pages, setPages] = useState<PageRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(
    async (search: string) => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/compliance/upload/${uploadId}${search ? `?q=${encodeURIComponent(search)}` : ''}`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) setError(json?.error || 'Failed to load document')
        else {
          setUpload(json.upload)
          setPages(json.pages ?? [])
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error')
      }
      setLoading(false)
    },
    [uploadId],
  )

  useEffect(() => {
    void load('')
  }, [load])

  async function act(action: 'reprocess' | 'structure') {
    setBusy(action)
    setError('')
    try {
      const res = await fetch(`/api/compliance/upload/${uploadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setError(json?.error || `${action} failed`)
      else {
        await load(q)
        onChanged()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setBusy('')
  }

  async function remove() {
    if (!confirm('Delete this document and its extracted text? The original file will be removed.')) return
    setBusy('delete')
    try {
      const res = await fetch(`/api/compliance/upload/${uploadId}`, { method: 'DELETE' })
      if (res.ok) onChanged()
      else {
        const json = await res.json().catch(() => ({}))
        setError(json?.error || 'Delete failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setBusy('')
  }

  const isImage = upload?.content_type?.startsWith('image/')
  const isPdf = upload?.content_type === 'application/pdf' || upload?.filename.toLowerCase().endsWith('.pdf')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Document review</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => act('reprocess')}>
            <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden /> {busy === 'reprocess' ? 'Reprocessing…' : 'Reprocess'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => act('structure')}>
            <Layers className="mr-1 h-3.5 w-3.5" aria-hidden /> {busy === 'structure' ? 'Structuring…' : 'Structure report'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== ''} onClick={remove}>
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Delete
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Original preview */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Original</div>
              {upload?.url ? (
                isPdf ? (
                  <iframe title="Original document" src={upload.url} className="h-[520px] w-full rounded-md border" />
                ) : isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={upload.url} alt={upload.filename} className="max-h-[520px] w-full rounded-md border object-contain" />
                ) : (
                  <a href={upload.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                    Open original
                  </a>
                )
              ) : (
                <p className="text-sm text-muted-foreground">Preview unavailable.</p>
              )}
            </div>

            {/* Extracted text + search */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search within document…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void load(q)
                  }}
                />
                <Button size="sm" variant="outline" onClick={() => load(q)}>
                  Search
                </Button>
                {q ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setQ('')
                      void load('')
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              <div className="max-h-[520px] space-y-3 overflow-y-auto rounded-md border p-3">
                {pages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {q ? 'No pages match that search.' : 'No extracted text. Try reprocessing.'}
                  </p>
                ) : (
                  pages.map((p) => (
                    <div key={p.page_number}>
                      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        Page {p.page_number}
                        {p.low_confidence ? <Badge variant="assumption">low confidence</Badge> : null}
                      </div>
                      <pre className="whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">{p.text || '(no text on this page)'}</pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
