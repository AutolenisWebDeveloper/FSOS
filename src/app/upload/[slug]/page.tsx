'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, UploadCloud, FileText } from 'lucide-react'
import { PublicPage, PublicCard, PublicAlert } from '@/components/public/PublicShell'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

// Public route — no auth required
export const dynamic = 'force-dynamic'

const DOCUMENT_TYPES = [
  { value: 'client_application', label: 'Client Application' },
  { value: 'id_document', label: 'ID / Drivers License' },
  { value: 'existing_policy', label: 'Existing Policy' },
  { value: 'financial_statement', label: 'Financial Statement' },
  { value: 'beneficiary_form', label: 'Beneficiary Form' },
  { value: 'change_request', label: 'Change Request' },
  { value: 'other', label: 'Other' },
]

export default function AgencyUploadPage() {
  const params = useParams()
  const slug = params.slug as string

  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [form, setForm] = useState({
    customer_name: '',
    customer_email: '',
    document_type: 'client_application',
    notes: '',
  })
  const [file, setFile] = useState<File | null>(null)

  const MAX_BYTES = 10 * 1024 * 1024
  const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'csv', 'xlsx', 'xls', 'doc', 'docx']

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null
    if (f) {
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      if (!ALLOWED_EXT.includes(ext)) {
        setError(`File type .${ext} is not allowed. Accepted: ${ALLOWED_EXT.join(', ')}.`)
        setFile(null); setFileName(''); e.target.value = ''
        return
      }
      if (f.size > MAX_BYTES) {
        setError('That file is larger than 10MB. Please choose a smaller file.')
        setFile(null); setFileName(''); e.target.value = ''
        return
      }
    }
    setError('')
    setFile(f)
    setFileName(f?.name || '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!form.customer_name.trim()) { setError('Please enter the client\'s name.'); return }
    if (!file) { setError('Please select a file to upload.'); return }

    setSubmitting(true)
    setError('')

    const formData = new FormData()
    formData.append('agency_slug', slug)
    formData.append('customer_name', form.customer_name)
    formData.append('customer_email', form.customer_email)
    formData.append('document_type', form.document_type)
    formData.append('notes', form.notes)
    formData.append('file', file)

    try {
      const res = await fetch('/api/agencies/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        setSubmitted(true)
      } else {
        setError(data.error || 'Upload failed. Please try again.')
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <PublicPage>
      <PublicCard subtitle="Markist · Secure Document Upload">
        <div className="py-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-won/10">
            <CheckCircle2 className="h-6 w-6 text-status-won" aria-hidden />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-foreground">Upload complete</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The document has been received. Markist will review it shortly.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => { setSubmitted(false); setFile(null); setFileName(''); setForm({ customer_name: '', customer_email: '', document_type: 'client_application', notes: '' }) }}
          >
            Upload another document
          </Button>
        </div>
      </PublicCard>
    </PublicPage>
  )

  return (
    <PublicPage>
      <PublicCard subtitle="Markist · Secure Document Upload">
        <h1 className="text-lg font-semibold text-foreground">Upload client document</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Securely send client documents to Markist for review.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field id="customer_name" label="Client full name" required>
            <Input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} placeholder="Jane Smith" autoComplete="name" />
          </Field>
          <Field id="customer_email" label="Client email">
            <Input type="email" value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} placeholder="jane@example.com" autoComplete="off" />
          </Field>
          <Field id="document_type" label="Document type">
            <Select value={form.document_type} onChange={e => setForm(f => ({ ...f, document_type: e.target.value }))}>
              {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>

          <div className="space-y-1.5">
            <Label htmlFor="file-upload">
              File<span className="ml-0.5 text-destructive" aria-hidden> *</span>
            </Label>
            <div className="relative rounded-lg border-2 border-dashed border-input bg-muted/40 px-4 py-6 text-center transition-colors hover:border-ring/60 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
              <input
                id="file-upload"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls,.doc,.docx"
                onChange={handleFileChange}
                required
                aria-describedby="file-hint"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              {fileName ? (
                <div className="flex flex-col items-center gap-1">
                  <FileText className="h-6 w-6 text-primary" aria-hidden />
                  <span className="text-sm font-medium text-foreground">{fileName}</span>
                  <span className="text-xs text-muted-foreground">Click to change</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <UploadCloud className="h-7 w-7 text-muted-foreground" aria-hidden />
                  <span className="text-sm text-muted-foreground">Click to select a file</span>
                  <span id="file-hint" className="text-xs text-muted-foreground">PDF, JPG, PNG, DOC — Max 10MB</span>
                </div>
              )}
            </div>
          </div>

          <Field id="notes" label="Notes" hint="Optional — any context for Markist.">
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any context for Markist…" rows={3} />
          </Field>

          {error && <PublicAlert>{error}</PublicAlert>}

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            {submitting ? 'Uploading…' : 'Upload document'}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
          Markist · Farmers Financial Solutions, LLC<br />
          Securities offered through Farmers Financial Solutions, LLC, Member FINRA &amp; SIPC
        </p>
      </PublicCard>
    </PublicPage>
  )
}
