'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'

// Public route — no auth required
export const dynamic = 'force-dynamic'

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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null
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
    <Page>
      <div style={{ textAlign: 'center', padding: '40px 32px' }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>📁</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a2332', margin: '0 0 12px' }}>Upload Complete</h2>
        <p style={{ fontSize: 14, color: '#6b7a8d', lineHeight: 1.7, margin: 0 }}>
          The document has been received. Markist will review it shortly.
        </p>
        <button
          onClick={() => { setSubmitted(false); setFile(null); setFileName(''); setForm({ customer_name: '', customer_email: '', document_type: 'client_application', notes: '' }) }}
          style={{ marginTop: 24, padding: '10px 24px', background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Upload Another Document
        </button>
      </div>
    </Page>
  )

  return (
    <Page>
      <div style={{ padding: '24px 32px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a2332', margin: '0 0 6px' }}>Upload Client Document</h2>
        <p style={{ fontSize: 13, color: '#6b7a8d', margin: '0 0 24px', lineHeight: 1.6 }}>
          Securely send client documents to Markist for review.
        </p>

        <form onSubmit={handleSubmit}>
          <Field label="Client Full Name *" value={form.customer_name} onChange={v => setForm(f => ({ ...f, customer_name: v }))} required placeholder="Jane Smith" />
          <Field label="Client Email" value={form.customer_email} onChange={v => setForm(f => ({ ...f, customer_email: v }))} type="email" placeholder="jane@example.com" />

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3d4a5c', marginBottom: 5 }}>Document Type</label>
            <select
              value={form.document_type}
              onChange={e => setForm(f => ({ ...f, document_type: e.target.value }))}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d9e0', borderRadius: 6, fontSize: 14, color: '#1a2332', background: '#fff', boxSizing: 'border-box' }}
            >
              <option value="client_application">Client Application</option>
              <option value="id_document">ID / Drivers License</option>
              <option value="existing_policy">Existing Policy</option>
              <option value="financial_statement">Financial Statement</option>
              <option value="beneficiary_form">Beneficiary Form</option>
              <option value="change_request">Change Request</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3d4a5c', marginBottom: 5 }}>File *</label>
            <div style={{ border: '2px dashed #d1d9e0', borderRadius: 8, padding: '20px', textAlign: 'center', background: '#fafbfc', cursor: 'pointer', position: 'relative' }}>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={handleFileChange}
                required
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
              />
              {fileName ? (
                <div>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>📎</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a2332' }}>{fileName}</div>
                  <div style={{ fontSize: 11, color: '#6b7a8d', marginTop: 2 }}>Click to change</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
                  <div style={{ fontSize: 13, color: '#6b7a8d' }}>Click to select a file</div>
                  <div style={{ fontSize: 11, color: '#a8b4c0', marginTop: 2 }}>PDF, JPG, PNG, DOC — Max 10MB</div>
                </div>
              )}
            </div>
          </div>

          <Field label="Notes (optional)" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} type="textarea" placeholder="Any context for Markist…" />

          {error && (
            <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#e53e3e' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%', padding: 14, background: submitting ? '#a0aec0' : '#2b6cb0',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Uploading…' : 'Upload Document'}
          </button>
        </form>

        <p style={{ fontSize: 11, color: '#a8b4c0', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
          Markist · Farmers Financial Solutions, LLC<br />
          Securities offered through Farmers Financial Solutions, LLC, Member FINRA &amp; SIPC
        </p>
      </div>
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', fontFamily: "'DM Sans', 'Segoe UI', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' }}>
      <div style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e4e8ef', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
        <div style={{ background: '#0f1e36', padding: '20px 32px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '.04em' }}>FARMERS FINANCIAL SOLUTIONS</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>Markist · Secure Document Upload</div>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, required, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: string; placeholder?: string
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', border: '1px solid #d1d9e0', borderRadius: 6,
    fontSize: 14, color: '#1a2332', background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit',
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3d4a5c', marginBottom: 5 }}>{label}</label>
      {type === 'textarea' ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} style={inputStyle} />
      )}
    </div>
  )
}
