'use client'

// DocumentUpload — the reusable upload surface for the Compliance Intelligence
// document pipeline. Drag-and-drop + file picker, multi-file, per-file size /
// progress / staged processing status, retry, cancel, duplicate warning, client-side
// validation, and an unsupported-type explanation. Posts multipart to
// /api/compliance/upload; the server secures, extracts, and returns the final record.
// Never silently fails — every file shows a clear terminal state.

import { useCallback, useId, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UploadCloud, FileText, X, RotateCw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

export interface UploadedDoc {
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
  url: string | null
}

const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md', 'csv']
const MAX_BYTES = 30 * 1024 * 1024

type Phase = 'validating' | 'uploading' | 'processing' | 'done' | 'error' | 'duplicate'

interface Item {
  localId: string
  file: File
  progress: number
  phase: Phase
  message?: string
  result?: UploadedDoc
  xhr?: XMLHttpRequest
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded',
  secured: 'Secured',
  extracting: 'Extracting text',
  extracted: 'Text extracted',
  structuring: 'Structuring',
  analyzed: 'Analysis ready',
  needs_review: 'Needs human review',
  failed: 'Failed',
}

function statusVariant(status: string): 'won' | 'pending' | 'blocked' | 'assumption' | 'outline' {
  if (status === 'analyzed' || status === 'extracted') return 'won'
  if (status === 'needs_review') return 'assumption'
  if (status === 'failed') return 'blocked'
  return 'pending'
}

export function DocumentUpload({
  caseId = null,
  kind = 'other',
  multiple = true,
  compact = false,
  onUploaded,
}: {
  caseId?: string | null
  kind?: string
  multiple?: boolean
  compact?: boolean
  onUploaded?: (doc: UploadedDoc) => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  const update = useCallback((localId: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)))
  }, [])

  const send = useCallback(
    (item: Item, force = false) => {
      const fd = new FormData()
      fd.append('file', item.file)
      if (caseId) fd.append('case_id', caseId)
      fd.append('kind', kind)
      if (force) fd.append('force', '1')

      const xhr = new XMLHttpRequest()
      update(item.localId, { phase: 'uploading', progress: 0, message: undefined, xhr })
      xhr.open('POST', '/api/compliance/upload')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100)
          update(item.localId, { progress: pct, phase: pct >= 100 ? 'processing' : 'uploading' })
        }
      }
      xhr.onload = () => {
        let json: Record<string, unknown> = {}
        try {
          json = JSON.parse(xhr.responseText)
        } catch {
          /* non-JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          if (json.duplicate) {
            update(item.localId, {
              phase: 'duplicate',
              message: (json.message as string) || 'An identical file was already uploaded.',
            })
            return
          }
          const result = json.upload as UploadedDoc | undefined
          if (result) {
            update(item.localId, { phase: 'done', progress: 100, result })
            onUploaded?.(result)
          } else {
            update(item.localId, { phase: 'error', message: 'Unexpected server response.' })
          }
        } else {
          update(item.localId, { phase: 'error', message: (json.error as string) || `Upload failed (${xhr.status})` })
        }
      }
      xhr.onerror = () => update(item.localId, { phase: 'error', message: 'Network error during upload.' })
      xhr.onabort = () => update(item.localId, { phase: 'error', message: 'Upload cancelled.' })
      xhr.send(fd)
    },
    [caseId, kind, onUploaded, update],
  )

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files)
      for (const file of list) {
        const localId = `${file.name}-${file.size}-${Math.floor(performance.now())}-${Math.round(performance.now() * 1000) % 1000}`
        const ext = extOf(file.name)
        let phase: Phase = 'uploading'
        let message: string | undefined
        if (!ALLOWED_EXT.includes(ext)) {
          phase = 'error'
          message = `.${ext || '(none)'} is not supported. Use PDF, an image (PNG/JPG/WEBP), or a text file (TXT/MD/CSV).`
        } else if (file.size > MAX_BYTES) {
          phase = 'error'
          message = `File is ${fmtBytes(file.size)} — exceeds the ${fmtBytes(MAX_BYTES)} limit.`
        }
        const item: Item = { localId, file, progress: 0, phase, message }
        setItems((prev) => [item, ...prev])
        if (phase !== 'error') send(item)
      }
    },
    [send],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
    },
    [addFiles],
  )

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 text-center transition-colors ${
          compact ? 'py-4' : 'py-8'
        } ${dragging ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/60 hover:bg-muted/40'}`}
      >
        <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden />
        <div className="text-sm font-medium">Drag &amp; drop{multiple ? ' files' : ' a file'} here, or click to browse</div>
        <div className="text-xs text-muted-foreground">
          Full multi-page PDFs (native or scanned), images, or text — up to {fmtBytes(MAX_BYTES)} each
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple={multiple}
          accept={ALLOWED_EXT.map((e) => `.${e}`).join(',')}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.localId} className="rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{it.file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtBytes(it.file.size)}
                      {it.result ? ` · ${it.result.page_count} page(s) · ${it.result.char_count.toLocaleString()} chars` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {it.phase === 'uploading' && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {it.progress}%
                    </span>
                  )}
                  {it.phase === 'processing' && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Processing…
                    </span>
                  )}
                  {it.phase === 'done' && it.result && (
                    <Badge variant={statusVariant(it.result.status)}>
                      {it.result.status === 'analyzed' || it.result.status === 'extracted' ? (
                        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                      ) : it.result.status === 'needs_review' ? (
                        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
                      ) : null}
                      {STATUS_LABEL[it.result.status] ?? it.result.status}
                    </Badge>
                  )}
                  {it.phase === 'duplicate' && <Badge variant="assumption">Duplicate</Badge>}
                  {it.phase === 'error' && <Badge variant="blocked">Error</Badge>}
                  {it.phase === 'uploading' && it.xhr && (
                    <button
                      type="button"
                      aria-label="Cancel upload"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => it.xhr?.abort()}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>

              {(it.phase === 'uploading' || it.phase === 'processing') && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${it.phase === 'processing' ? 100 : it.progress}%` }}
                  />
                </div>
              )}

              {it.message && (
                <p className={`mt-2 text-xs ${it.phase === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {it.message}
                </p>
              )}

              {it.result?.low_confidence && it.phase === 'done' && (
                <p className="mt-2 rounded border border-status-assumption/40 bg-status-assumption/10 px-2 py-1 text-xs text-status-assumption">
                  Low extraction confidence
                  {it.result.extraction_confidence != null
                    ? ` (${Math.round(it.result.extraction_confidence * 100)}%)`
                    : ''}{' '}
                  — inspect the original page beside the extracted text before relying on it.
                </p>
              )}

              {(it.phase === 'error' || it.phase === 'duplicate') && ALLOWED_EXT.includes(extOf(it.file.name)) && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => send(it, it.phase === 'duplicate')}>
                    <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                    {it.phase === 'duplicate' ? 'Upload anyway' : 'Retry'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
