'use client'

// Public workshop registration page (rendered at /events/[id]).
// Fetches safe workshop details, collects name/email/phone, and registers the
// attendee via the public POST /api/workshops/register endpoint.

import { useEffect, useState } from 'react'

interface Workshop {
  workshop_id: string
  title: string
  topic: string
  scheduled_at: string | null
  location: string | null
  seats_remaining: number | null
  is_full: boolean
}

const wrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f4f6f9',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
}
const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  boxShadow: '0 10px 40px rgba(15,30,54,.12)',
  width: '100%',
  maxWidth: 460,
  overflow: 'hidden',
}
const input: React.CSSProperties = {
  width: '100%',
  padding: '11px 12px',
  border: '1px solid #d9e0e8',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  marginBottom: 12,
  boxSizing: 'border-box',
}

export default function WorkshopRegister({ workshopId }: { workshopId: string }) {
  const [workshop, setWorkshop] = useState<Workshop | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/workshops/register?workshop_id=${encodeURIComponent(workshopId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
        return d
      })
      .then((d) => setWorkshop(d.workshop))
      .catch((e) => setLoadErr(String(e.message || e)))
  }, [workshopId])

  const submit = async () => {
    setErr(null)
    if (!form.name.trim() || !form.email.trim()) {
      setErr('Please enter your name and email.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/workshops/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workshop_id: workshopId, ...form }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setErr(d.error || `Registration failed (HTTP ${res.status})`)
      else setDone(true)
    } catch {
      setErr('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const when = workshop?.scheduled_at
    ? new Date(workshop.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'

  return (
    <div style={wrap}>
      <div style={cardStyle}>
        <div style={{ background: 'linear-gradient(135deg,#2b6cb0,#0f1e36)', color: '#fff', padding: '22px 24px' }}>
          <div style={{ fontSize: 12, opacity: 0.8, letterSpacing: '.08em', textTransform: 'uppercase' }}>Workshop Registration</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{workshop?.title || (loadErr ? 'Workshop' : 'Loading…')}</div>
        </div>
        <div style={{ padding: 24 }}>
          {loadErr && <div style={{ color: '#c53030', fontSize: 14 }}>Could not load this workshop: {loadErr}</div>}

          {!loadErr && workshop && !done && (
            <>
              <div style={{ fontSize: 13, color: '#4a5568', marginBottom: 4 }}>📅 {when}</div>
              {workshop.location && <div style={{ fontSize: 13, color: '#4a5568', marginBottom: 4 }}>📍 {workshop.location}</div>}
              {workshop.seats_remaining !== null && (
                <div style={{ fontSize: 12, color: workshop.is_full ? '#c53030' : '#2f855a', marginBottom: 16, fontWeight: 600 }}>
                  {workshop.is_full ? 'This workshop is full' : `${workshop.seats_remaining} seats remaining`}
                </div>
              )}
              {!workshop.is_full && (
                <>
                  <input style={input} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <input style={input} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  <input style={input} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  {err && <div style={{ color: '#c53030', fontSize: 13, marginBottom: 10 }}>{err}</div>}
                  <button
                    onClick={submit}
                    disabled={submitting}
                    style={{ width: '100%', padding: 13, background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
                  >
                    {submitting ? 'Registering…' : 'Register'}
                  </button>
                  <div style={{ fontSize: 10, color: '#a0aec0', marginTop: 12, lineHeight: 1.5 }}>
                    By registering you agree to be contacted about this event. Educational information only — not investment advice.
                  </div>
                </>
              )}
            </>
          )}

          {done && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#0f1e36', marginBottom: 6 }}>You&apos;re registered!</div>
              <div style={{ fontSize: 13, color: '#4a5568' }}>A confirmation has been sent to {form.email}. We&apos;ll see you on {when}.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
