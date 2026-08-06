'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  KNOWLEDGE_KIND,
  KNOWLEDGE_CONTENT_MAX,
  KnowledgeCreateSchema,
  KnowledgePatchSchema,
} from '@/lib/validation/schemas'
import { postJson, patchJson, deleteJson, getJson, firstFieldError } from '@/lib/client/api'

/*
 * AI Knowledge Library controls.
 *
 * Three entry points, one shared field set:
 *   • Upload a file   — the actual PDF / scan / notice. The server secures the
 *     original privately, extracts its text, and indexes that text for retrieval.
 *   • Write a document — type or paste the knowledge directly.
 *   • Row actions      — edit, download the original, archive (reversible), restore,
 *     or permanently delete.
 *
 * Farmers-specific figures must be flagged "config default — verify" (§4.3) so the
 * AI surfaces them as unverified configuration rather than asserting them as fact.
 */

// ─── Shared field set (create · upload · edit) ────────────────────────────────

export interface KnowledgeFieldValues {
  title: string
  kind: string
  category: string
  summary: string
  tags: string
  status: string
  visibility: string
  is_assumption: boolean
}

const EMPTY_FIELDS: KnowledgeFieldValues = {
  title: '',
  kind: 'document',
  category: '',
  summary: '',
  tags: '',
  status: 'published',
  visibility: 'internal',
  is_assumption: false,
}

const KIND_LABEL = (k: string) => k.replace(/_/g, ' ')

function KnowledgeFields({
  idPrefix,
  values,
  onChange,
  errors,
  titleRequired = true,
  titleHint,
  /** Offer "archived" as a status — only when editing a document that already is. */
  allowArchived = false,
}: {
  idPrefix: string
  values: KnowledgeFieldValues
  onChange: (patch: Partial<KnowledgeFieldValues>) => void
  errors: Record<string, string>
  titleRequired?: boolean
  titleHint?: string
  allowArchived?: boolean
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-title`} label="Title" required={titleRequired} hint={titleHint} error={errors.title}>
          <Input value={values.title} onChange={(e) => onChange({ title: e.target.value })} />
        </Field>
        <Field id={`${idPrefix}-kind`} label="Kind" error={errors.kind}>
          <Select value={values.kind} onChange={(e) => onChange({ kind: e.target.value })}>
            {KNOWLEDGE_KIND.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${idPrefix}-category`} label="Category" error={errors.category}>
          <Input
            value={values.category}
            onChange={(e) => onChange({ category: e.target.value })}
            placeholder="compliance, products, operations…"
          />
        </Field>
        <Field id={`${idPrefix}-tags`} label="Tags (comma-separated)" error={errors.tags}>
          <Input
            value={values.tags}
            onChange={(e) => onChange({ tags: e.target.value })}
            placeholder="term-conversion, life, education"
          />
        </Field>
      </div>
      <Field
        id={`${idPrefix}-summary`}
        label="Summary"
        hint="One or two sentences the AI can cite as background."
        error={errors.summary}
      >
        <Textarea value={values.summary} onChange={(e) => onChange({ summary: e.target.value })} rows={2} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id={`${idPrefix}-status`}
          label="Status"
          hint={allowArchived ? 'Choose published or draft to restore this document.' : undefined}
          error={errors.status}
        >
          <Select value={values.status} onChange={(e) => onChange({ status: e.target.value })}>
            <option value="published">published</option>
            <option value="draft">draft</option>
            {allowArchived ? <option value="archived">archived</option> : null}
          </Select>
        </Field>
        <Field id={`${idPrefix}-visibility`} label="Visibility" error={errors.visibility}>
          <Select value={values.visibility} onChange={(e) => onChange({ visibility: e.target.value })}>
            <option value="internal">internal</option>
            <option value="client_safe">client-safe</option>
          </Select>
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={values.is_assumption}
            onChange={(e) => onChange({ is_assumption: e.target.checked })}
          />
          <span>Config default — verify (Farmers-specific)</span>
        </label>
      </div>
    </>
  )
}

/**
 * Field values → the JSON payload shape the create/patch schemas expect.
 *
 * `blank` is what an emptied optional field becomes: `undefined` on create (the field
 * is simply omitted) but `null` on edit — otherwise clearing a category would store an
 * empty string instead of erasing it, and the list would render a blank cell where it
 * should render an em dash.
 */
function toPayload(values: KnowledgeFieldValues, content: string, blank: undefined | null = undefined) {
  return {
    title: values.title,
    kind: values.kind,
    category: values.category.trim() === '' ? blank : values.category,
    summary: values.summary.trim() === '' ? blank : values.summary,
    content,
    tags: values.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    status: values.status,
    visibility: values.visibility,
    is_assumption: values.is_assumption,
  }
}

function zodErrors(err: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }): Record<string, string> {
  return Object.fromEntries(
    Object.entries(err.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? 'Invalid']),
  )
}

// ─── Toolbar: upload + write, side by side ────────────────────────────────────

export function KnowledgeToolbar() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <KnowledgeUploadForm />
      <KnowledgeCreateForm />
    </div>
  )
}

// ─── Upload a file ────────────────────────────────────────────────────────────

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv'

interface UploadedDoc {
  id: string
  title: string
  page_count: number | null
  char_count: number | null
  low_confidence: boolean
  content_truncated: boolean
  extraction_error: string | null
}

export function KnowledgeUploadForm() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<KnowledgeFieldValues>(EMPTY_FIELDS)
  const [file, setFile] = React.useState<File | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [uploading, setUploading] = React.useState(false)
  // Set when the server reports identical bytes already in the library; the next
  // submit is an explicit "keep both" rather than a silent duplicate.
  const [duplicate, setDuplicate] = React.useState<{ id: string; title: string } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  function reset() {
    setValues(EMPTY_FIELDS)
    setFile(null)
    setErrors({})
    setDuplicate(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Metadata edits must NOT clear the duplicate warning: it is about the bytes, and
  // clearing it would drop the `force` flag so "Upload anyway" just warns again.
  function change(patch: Partial<KnowledgeFieldValues>) {
    setValues((v) => ({ ...v, ...patch }))
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null
    setFile(next)
    setErrors((prev) => ({ ...prev, file: '' }))
    // Different bytes → the previous duplicate verdict no longer applies.
    setDuplicate(null)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) {
      setErrors({ file: 'Choose a file to upload.' })
      return
    }
    setErrors({})
    setUploading(true)

    const fd = new FormData()
    fd.set('file', file)
    fd.set('title', values.title)
    fd.set('kind', values.kind)
    fd.set('category', values.category)
    fd.set('summary', values.summary)
    fd.set('tags', values.tags)
    fd.set('status', values.status)
    fd.set('visibility', values.visibility)
    if (values.is_assumption) fd.set('is_assumption', '1')
    // Second submit after a duplicate warning = the operator chose to keep both.
    if (duplicate) fd.set('force', '1')

    let payload: {
      document?: UploadedDoc
      duplicate?: boolean
      message?: string
      error?: string
      hint?: string
    } = {}
    try {
      const res = await fetch('/api/knowledge/upload', { method: 'POST', body: fd })
      payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUploading(false)
        const message = payload.error ?? 'Upload failed. Please try again.'
        setErrors({ file: payload.hint ? `${message} ${payload.hint}` : message })
        toast.error(message)
        return
      }
    } catch {
      setUploading(false)
      const message = 'Network error — the file was not uploaded. Please try again.'
      setErrors({ file: message })
      toast.error(message)
      return
    }
    setUploading(false)

    if (payload.duplicate && payload.document) {
      setDuplicate(payload.document as { id: string; title: string })
      toast.warning(payload.message ?? 'This file is already in the library.')
      return
    }

    const doc = payload.document
    if (doc?.extraction_error) {
      toast.warning('File stored, but its text could not be read. Open it to paste the content in.')
    } else if (doc?.low_confidence) {
      toast.warning('File stored. Very little text was readable — check the indexed content.')
    } else if (doc?.content_truncated) {
      toast.success('File added. Indexed text was clipped at the library limit; the original is attached in full.')
    } else {
      toast.success(`Added "${doc?.title ?? file.name}" to the library.`)
    }

    reset()
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Upload file
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (uploading) return
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload a document</DialogTitle>
            <DialogDescription>
              The original file is stored privately and stays downloadable. Its text is extracted and indexed so the AI
              can retrieve from it.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field
              id="knowledge-upload-file"
              label="File"
              required
              hint="PDF, image (PNG/JPG/WEBP/GIF), or text (TXT/MD/CSV), up to 30MB. Scanned PDFs are read with OCR."
              error={errors.file}
            >
              <input
                ref={fileInputRef}
                type="file"
                name="file"
                accept={ACCEPTED}
                onChange={onFile}
                className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:border-primary/50 hover:file:bg-primary-soft/50"
              />
            </Field>

            {duplicate ? (
              <p role="alert" className="rounded-md border border-status-assumption/40 bg-status-assumption/10 p-3 text-sm">
                <span className="font-medium">“{duplicate.title}”</span> already holds this exact file. Submit again to
                keep both copies, or cancel and edit the existing document instead.
              </p>
            ) : null}

            <KnowledgeFields
              idPrefix="knowledge-upload"
              values={values}
              onChange={change}
              errors={errors}
              titleRequired={false}
              titleHint="Leave blank to use the file name."
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button type="submit" loading={uploading}>
                {duplicate ? 'Upload anyway' : 'Upload'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Write a document by hand ─────────────────────────────────────────────────

export function KnowledgeCreateForm() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<KnowledgeFieldValues>(EMPTY_FIELDS)
  const [content, setContent] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  function reset() {
    setValues(EMPTY_FIELDS)
    setContent('')
    setErrors({})
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const parsed = KnowledgeCreateSchema.safeParse(toPayload(values, content))
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error))
      return
    }
    setSaving(true)
    const res = await postJson<{ document: { id: string } }>('/api/knowledge', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Added to the Knowledge Library.')
    reset()
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Write a document</Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (saving) return
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Write a document</DialogTitle>
            <DialogDescription>
              Type or paste knowledge the AI should retrieve from. To add an existing file instead, use Upload file.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <KnowledgeFields
              idPrefix="knowledge-create"
              values={values}
              onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
              errors={errors}
            />
            <Field id="knowledge-create-content" label="Content" error={errors.content}>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                maxLength={KNOWLEDGE_CONTENT_MAX}
                placeholder="Full text the AI retrieves from when responding to a contact."
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Add to library
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Row actions: edit · download · archive · restore · delete ────────────────

export interface KnowledgeRow {
  id: string
  title: string
  kind: string
  category: string | null
  summary: string | null
  tags: string[] | null
  status: string
  visibility: string
  is_assumption: boolean
  file_name: string | null
}

interface LoadedDoc {
  content: string | null
  url: string | null
  file_name: string | null
  size_bytes: number | null
  page_count: number | null
  extraction_method: string | null
  low_confidence: boolean
  content_truncated: boolean
  extraction_error: string | null
}

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function KnowledgeRowActions({ doc }: { doc: KnowledgeRow }) {
  const router = useRouter()
  const archived = doc.status === 'archived'

  const [editOpen, setEditOpen] = React.useState(false)
  const [values, setValues] = React.useState<KnowledgeFieldValues>(EMPTY_FIELDS)
  const [content, setContent] = React.useState('')
  const [loaded, setLoaded] = React.useState<LoadedDoc | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  // Fetch the full record (content + a fresh signed URL) only when the editor opens —
  // the list intentionally doesn't carry the body text of every document.
  async function openEdit() {
    setEditOpen(true)
    setErrors({})
    setLoadError(null)
    setLoading(true)
    setValues({
      title: doc.title,
      kind: doc.kind,
      category: doc.category ?? '',
      summary: doc.summary ?? '',
      tags: (doc.tags ?? []).join(', '),
      // An archived document opens as archived — saving must not silently republish
      // it. Restoring is an explicit status change (or the Restore button).
      status: doc.status,
      visibility: doc.visibility,
      is_assumption: doc.is_assumption,
    })
    const res = await getJson<{ document: LoadedDoc }>(`/api/knowledge/${doc.id}`)
    setLoading(false)
    if (!res.ok) {
      setLoadError(firstFieldError(res.error).message)
      return
    }
    setLoaded(res.data.document)
    setContent(res.data.document.content ?? '')
  }

  async function saveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const parsed = KnowledgePatchSchema.safeParse(toPayload(values, content, null))
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error))
      return
    }
    setSaving(true)
    const res = await patchJson<{ document: { id: string } }>(`/api/knowledge/${doc.id}`, parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Document updated.')
    setEditOpen(false)
    router.refresh()
  }

  async function archive() {
    setBusy(true)
    const res = await deleteJson<{ ok: true }>(`/api/knowledge/${doc.id}`)
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Archived “${doc.title}”. It no longer reaches the AI.`)
    router.refresh()
  }

  async function restore() {
    setBusy(true)
    const res = await patchJson<{ document: { id: string } }>(`/api/knowledge/${doc.id}`, { status: 'published' })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Restored “${doc.title}”.`)
    router.refresh()
  }

  async function confirmDelete() {
    setDeleting(true)
    const res = await deleteJson<{ ok: true; file_removed?: boolean }>(
      `/api/knowledge/${doc.id}?mode=permanent`,
    )
    setDeleting(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (res.data.file_removed === false) {
      toast.warning('Document deleted, but its stored file could not be removed. It has been logged for cleanup.')
    } else {
      toast.success(`Permanently deleted “${doc.title}”.`)
    }
    setDeleteOpen(false)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button size="sm" variant="outline" onClick={openEdit}>
        Edit
      </Button>
      {archived ? (
        <Button size="sm" variant="outline" onClick={restore} loading={busy}>
          Restore
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={archive} loading={busy}>
          Archive
        </Button>
      )}
      <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteOpen(true)}>
        Delete
      </Button>

      {/* Edit — full record, including the extracted text of an uploaded file. */}
      <Dialog open={editOpen} onOpenChange={(o) => !saving && setEditOpen(o)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription className="break-words">{doc.title}</DialogDescription>
          </DialogHeader>

          {loadError ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-destructive">
                Couldn’t load this document: {loadError}
              </p>
              <Button variant="outline" onClick={openEdit}>
                Try again
              </Button>
            </div>
          ) : loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading document…</p>
          ) : (
            <form onSubmit={saveEdit} className="space-y-4" noValidate>
              {loaded?.file_name ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{loaded.file_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        formatBytes(loaded.size_bytes),
                        loaded.page_count ? `${loaded.page_count} page${loaded.page_count === 1 ? '' : 's'}` : '',
                        loaded.extraction_method ? `read via ${loaded.extraction_method.replace(/_/g, ' ')}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  {loaded.url ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={loaded.url} target="_blank" rel="noopener noreferrer">
                        Download original
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {loaded?.extraction_error ? (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  The text of this file couldn’t be read ({loaded.extraction_error}). The original is stored and
                  downloadable — paste the content below so the AI can retrieve from it.
                </p>
              ) : loaded?.low_confidence ? (
                <p className="rounded-md border border-status-assumption/40 bg-status-assumption/10 p-3 text-sm">
                  Very little readable text was extracted from this file. Check the content below before relying on it.
                </p>
              ) : loaded?.content_truncated ? (
                <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Indexed text was clipped at the library limit. The attached original is complete.
                </p>
              ) : null}

              <KnowledgeFields
                idPrefix={`knowledge-edit-${doc.id}`}
                values={values}
                onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
                errors={errors}
                allowArchived={archived}
              />
              <Field
                id={`knowledge-edit-${doc.id}-content`}
                label="Content"
                hint="The text the AI retrieves from. For an uploaded file this is the extracted text — edit it freely."
                error={errors.content}
              >
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  maxLength={KNOWLEDGE_CONTENT_MAX}
                />
              </Field>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Permanent delete — destructive, irreversible, and it says so. */}
      <Dialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this document permanently?</DialogTitle>
            <DialogDescription className="break-words">
              “{doc.title}”{doc.file_name ? ` and its uploaded file (${doc.file_name})` : ''} will be destroyed, along
              with the record of which AI replies cited it. This can’t be undone. To remove it from the AI reversibly,
              use Archive instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} loading={deleting}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
