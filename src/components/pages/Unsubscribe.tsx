'use client'

// Public opt-out page (/unsubscribe). Records an email/SMS opt-out via the
// public POST /api/consent/opt-out endpoint (writes to the consent ledger).

import { useState } from 'react'
import PublicFooter from '@/components/PublicFooter'

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

export default function Unsubscribe() {
  const [contact, setContact] = useState('')
  const [channel, setChannel] = useState<'all' | 'email' | 'sms'>('all')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (!contact.trim()) {
      setErr('Please enter your email or phone number.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/consent/opt-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: contact.trim(), channel }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setErr(d.error || 'Something went wrong. Please try again.')
      } else {
        setDone(true)
      }
    } catch {
      setErr('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ background: '#f4f6f9', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 14,
            boxShadow: '0 10px 40px rgba(15,30,54,.12)',
            width: '100%',
            maxWidth: 440,
            padding: 28,
            fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700, color: '#0f1e36', marginBottom: 6 }}>Unsubscribe / Opt-Out</div>
          {!done ? (
            <>
              <div style={{ fontSize: 13, color: '#4a5568', marginBottom: 18, lineHeight: 1.6 }}>
                Enter the email or phone number you&apos;d like us to stop contacting. This takes effect immediately for
                marketing messages.
              </div>
              <input style={input} placeholder="Email or phone number" value={contact} onChange={(e) => setContact(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {(['all', 'email', 'sms'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setChannel(c)}
                    style={{
                      flex: 1,
                      padding: '8px 6px',
                      borderRadius: 8,
                      border: `1px solid ${channel === c ? '#2b6cb0' : '#d9e0e8'}`,
                      background: channel === c ? '#ebf4ff' : '#fff',
                      color: channel === c ? '#2b6cb0' : '#4a5568',
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textTransform: 'capitalize',
                    }}
                  >
                    {c === 'all' ? 'All messages' : c}
                  </button>
                ))}
              </div>
              {err && <div style={{ color: '#c53030', fontSize: 13, marginBottom: 10 }}>{err}</div>}
              <button
                onClick={submit}
                disabled={submitting}
                style={{ width: '100%', padding: 13, background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? 'Processing…' : 'Opt me out'}
              </button>
              <div style={{ fontSize: 10, color: '#a0aec0', marginTop: 12, lineHeight: 1.5 }}>
                Note: we may still send messages required to service policies you currently hold, as permitted by law.
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#0f1e36', marginBottom: 6 }}>You&apos;re opted out</div>
              <div style={{ fontSize: 13, color: '#4a5568', lineHeight: 1.6 }}>
                We&apos;ve recorded your request. If you continue to receive marketing messages after a few days, please
                contact us directly.
              </div>
            </div>
          )}
        </div>
      </div>
      <PublicFooter />
    </div>
  )
}
