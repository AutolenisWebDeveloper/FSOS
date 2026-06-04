'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

// Public route — no auth required
export const dynamic = 'force-dynamic'

interface Agency {
  agency_id: string
  name: string
  owner: string
  city?: string
  slug?: string
}

export default function AgencyReferralPage() {
  const params = useParams()
  const slug = params.slug as string

  const [agency, setAgency] = useState<Agency | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    client_name: '',
    client_email: '',
    client_phone: '',
    referral_type: 'general',
    notes: '',
  })

  // Look up the agency by slug on load so we can greet by owner name
  useEffect(() => {
    if (!slug) return
    setLoading(true)
    fetch(`/api/agencies/referral?slug=${encodeURIComponent(slug)}`)
      .then(async res => {
        if (res.status === 404) { setNotFound(true); setAgency(null); return }
        const data = await res.json()
        if (data.error) { setNotFound(true); setAgency(null); return }
        setAgency({ ...data, slug })
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!form.client_name.trim()) { setError('Please enter the client\'s name.'); return }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/agencies/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency_slug: slug, ...form }),
      })
      const data = await res.json()
      if (data.success) {
        setSubmitted(true)
        if (data.message) setAgency(a => a ? { ...a, owner: data.message.split('!')[0].replace('Thank you! ', '') } : a)
      } else {
        setError(data.error || 'Submission failed. Please try again.')
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f9', fontFamily: 'sans-serif' }}>
      <div style={{ color: '#6b7a8d' }}>Loading…</div>
    </div>
  )

  if (notFound) return (
    <Page>
      <div style={{ textAlign: 'center', padding: '40px 32px' }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>🔗</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a2332', margin: '0 0 12px' }}>Referral link not active</h2>
        <p style={{ fontSize: 14, color: '#6b7a8d', lineHeight: 1.7, margin: 0 }}>
          This referral link is not active. Contact your agent for a new link.
        </p>
      </div>
    </Page>
  )

  if (submitted) return (
    <Page>
      <div style={{ textAlign: 'center', padding: '40px 32px' }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>🎉</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a2332', margin: '0 0 12px' }}>Referral Submitted!</h2>
        <p style={{ fontSize: 14, color: '#6b7a8d', lineHeight: 1.7, margin: 0 }}>
          Thank you for the referral. Markist will reach out to your client shortly.
          A questionnaire link will be sent to their email to prepare for the appointment.
        </p>
        <button
          onClick={() => { setSubmitted(false); setForm({ client_name: '', client_email: '', client_phone: '', referral_type: 'general', notes: '' }) }}
          style={{ marginTop: 24, padding: '10px 24px', background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Submit Another Referral
        </button>
      </div>
    </Page>
  )

  return (
    <Page>
      <div style={{ padding: '24px 32px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a2332', margin: '0 0 6px' }}>Refer a Client</h2>
        {agency?.owner && (
          <p style={{ fontSize: 13, color: '#2b6cb0', fontWeight: 600, margin: '0 0 6px' }}>
            Referred by {agency.owner}{agency.name ? ` — ${agency.name}` : ''}
          </p>
        )}
        <p style={{ fontSize: 13, color: '#6b7a8d', margin: '0 0 24px', lineHeight: 1.6 }}>
          Submit a client referral to Markist. Your client will receive a secure questionnaire
          to prepare for their financial review.
        </p>

        <form onSubmit={handleSubmit}>
          <Field label="Client Full Name *" value={form.client_name} onChange={v => setForm(f => ({ ...f, client_name: v }))} required placeholder="Jane Smith" />
          <Field label="Client Email" value={form.client_email} onChange={v => setForm(f => ({ ...f, client_email: v }))} type="email" placeholder="jane@example.com" />
          <Field label="Client Phone" value={form.client_phone} onChange={v => setForm(f => ({ ...f, client_phone: v }))} type="tel" placeholder="(555) 123-4567" />

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3d4a5c', marginBottom: 5 }}>Referral Type</label>
            <select
              value={form.referral_type}
              onChange={e => setForm(f => ({ ...f, referral_type: e.target.value }))}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d9e0', borderRadius: 6, fontSize: 14, color: '#1a2332', background: '#fff', boxSizing: 'border-box' }}
            >
              <option value="general">General Review</option>
              <option value="life">Life Insurance</option>
              <option value="retirement">Retirement Planning</option>
              <option value="conversion">Term Conversion</option>
              <option value="opra">OPRA Opportunity</option>
              <option value="business">Business Planning</option>
            </select>
          </div>

          <Field label="Notes (optional)" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} type="textarea" placeholder="Any context that would help Markist prepare…" />

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
            {submitting ? 'Submitting…' : 'Submit Referral'}
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
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>Markist · Licensed FSA · McKinney, TX</div>
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
