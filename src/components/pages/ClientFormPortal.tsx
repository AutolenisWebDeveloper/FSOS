'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

interface FormPortalProps {
  formId: string
}

const FORM_TITLES: Record<string, string> = {
  'customer-questionnaire':   'Customer Questionnaire',
  'customer-profile':         'Customer Profile Worksheet',
  'liability-exposure':       'Liability Exposure Worksheet',
  'cash-flow':                'Cash Flow Statement',
  'financial-position':       'Statement of Financial Position',
  'business-questionnaire':   'Business Information Questionnaire',
  'financial-needs-analysis': 'Financial Needs Analysis',
}

export default function ClientFormPortal({ formId }: FormPortalProps) {
  const searchParams = useSearchParams()
  const token = searchParams.get('t')
  const clientName = searchParams.get('client') || ''

  const [status, setStatus] = useState<'loading' | 'ready' | 'complete' | 'expired' | 'error'>('loading')
  const [formTitle, setFormTitle] = useState(FORM_TITLES[formId] || 'Form')
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [ref, setRef] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setStatus('error'); setError('Invalid form link — no token found.'); return }

    fetch(`/api/forms/submit?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setStatus('error'); setError(data.error); return }
        if (data.status === 'complete') { setStatus('complete'); return }
        if (new Date(data.expires_at) < new Date()) { setStatus('expired'); return }
        setFormTitle(data.form_title || FORM_TITLES[formId] || 'Form')
        setStatus('ready')
      })
      .catch(() => { setStatus('error'); setError('Unable to load form.') })
  }, [token, formId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || submitting) return
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, form_id: formId, response_data: { ...responses, client_name: clientName } }),
      })
      const data = await res.json()
      if (data.success) {
        setRef(data.ref)
        setStatus('complete')
      } else {
        setError(data.error || 'Submission failed.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const s: React.CSSProperties & Record<string, unknown> = {}
  void s

  if (status === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f9', fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: 'center', color: '#6b7a8d' }}>Loading your form…</div>
    </div>
  )

  if (status === 'expired') return (
    <Shell title={formTitle}>
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⏱</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1a2332', marginBottom: 8 }}>This link has expired</div>
        <div style={{ fontSize: 14, color: '#6b7a8d' }}>Please contact Markist to request a new form link.</div>
      </div>
    </Shell>
  )

  if (status === 'complete') return (
    <Shell title={formTitle}>
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2332', marginBottom: 8 }}>Thank you!</div>
        <div style={{ fontSize: 14, color: '#6b7a8d', marginBottom: ref ? 12 : 0 }}>
          Your {formTitle} has been received. Markist will review it before your appointment.
        </div>
        {ref && <div style={{ fontSize: 12, color: '#a8b4c0', fontFamily: 'monospace' }}>Reference: {ref}</div>}
      </div>
    </Shell>
  )

  if (status === 'error') return (
    <Shell title="Error">
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 14, color: '#e53e3e' }}>{error || 'An error occurred loading this form.'}</div>
      </div>
    </Shell>
  )

  return (
    <Shell title={formTitle}>
      <form onSubmit={handleSubmit} style={{ padding: '24px 32px' }}>
        {clientName && (
          <p style={{ fontSize: 15, color: '#1a2332', marginBottom: 20 }}>
            Hi <strong>{clientName}</strong>, please complete the form below.
          </p>
        )}

        <FormField label="Full Name" name="full_name" value={responses.full_name || clientName} onChange={v => setResponses(r => ({ ...r, full_name: v }))} required />
        <FormField label="Date of Birth" name="dob" type="date" value={responses.dob || ''} onChange={v => setResponses(r => ({ ...r, dob: v }))} />
        <FormField label="Phone Number" name="phone" type="tel" value={responses.phone || ''} onChange={v => setResponses(r => ({ ...r, phone: v }))} />
        <FormField label="Email Address" name="email" type="email" value={responses.email || ''} onChange={v => setResponses(r => ({ ...r, email: v }))} />
        <FormField label="Employer / Occupation" name="employer" value={responses.employer || ''} onChange={v => setResponses(r => ({ ...r, employer: v }))} />
        <FormField label="Annual Household Income" name="annual_income" value={responses.annual_income || ''} onChange={v => setResponses(r => ({ ...r, annual_income: v }))} placeholder="e.g. $85,000" />
        <FormField label="Current Life Insurance Coverage" name="life_coverage" value={responses.life_coverage || ''} onChange={v => setResponses(r => ({ ...r, life_coverage: v }))} placeholder="e.g. $500,000 or None" />
        <FormField label="Retirement Savings (Total)" name="retirement_savings" value={responses.retirement_savings || ''} onChange={v => setResponses(r => ({ ...r, retirement_savings: v }))} placeholder="e.g. $120,000" />
        <FormField label="Primary Financial Concern" name="primary_concern" type="textarea" value={responses.primary_concern || ''} onChange={v => setResponses(r => ({ ...r, primary_concern: v }))} placeholder="e.g. retirement income, protecting my family, college savings…" />

        {error && (
          <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#e53e3e' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%', padding: '14px', background: submitting ? '#a0aec0' : '#2b6cb0',
            color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer', marginTop: 8,
          }}
        >
          {submitting ? 'Submitting…' : 'Submit Form'}
        </button>

        <p style={{ fontSize: 11, color: '#a8b4c0', textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
          Your information is encrypted and used only to prepare for your financial review.
          Markist · Farmers Financial Solutions, LLC · Member FINRA &amp; SIPC
        </p>
      </form>
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', fontFamily: "'DM Sans', 'Segoe UI', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' }}>
      <div style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e4e8ef', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
        <div style={{ background: '#0f1e36', padding: '20px 32px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '.04em' }}>FARMERS FINANCIAL SOLUTIONS</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>{title}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormField({
  label, name, value, onChange, required, type = 'text', placeholder
}: {
  label: string; name: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: string; placeholder?: string
}) {
  const base: React.CSSProperties = {
    width: '100%', padding: '10px 12px', border: '1px solid #d1d9e0', borderRadius: 6,
    fontSize: 14, color: '#1a2332', outline: 'none', boxSizing: 'border-box',
    background: '#fff', fontFamily: 'inherit',
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3d4a5c', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#e53e3e' }}> *</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          name={name} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} rows={3}
          style={{ ...base, resize: 'vertical' }}
        />
      ) : (
        <input
          type={type} name={name} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} required={required}
          style={base}
        />
      )}
    </div>
  )
}
