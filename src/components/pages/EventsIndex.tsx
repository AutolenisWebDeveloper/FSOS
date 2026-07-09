'use client'

// Public upcoming-workshops index (/events). Lists open workshops with links to
// their registration pages (/events/[id]).

import { useEffect, useState } from 'react'
import PublicFooter from '@/components/PublicFooter'

interface EventItem {
  workshop_id: string
  title: string
  topic: string
  scheduled_at: string | null
  location: string | null
}

const TOPIC_ICON: Record<string, string> = {
  retirement: '🏖️',
  life: '🛡️',
  opra: '🔄',
  business: '💼',
  general: '📊',
}

export default function EventsIndex() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/events')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setEvents(d.events || []))
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ background: '#f4f6f9', minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 22px', width: '100%', boxSizing: 'border-box', flex: 1 }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: '#0f1e36', marginBottom: 4 }}>Upcoming Workshops</h1>
        <div style={{ fontSize: 14, color: '#6b7a8d', marginBottom: 24 }}>Free educational sessions on retirement, life, and financial planning.</div>

        {loading && <div style={{ color: '#6b7a8d' }}>Loading…</div>}
        {err && <div style={{ color: '#c53030' }}>Could not load workshops: {err}</div>}
        {!loading && !err && events.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center', color: '#6b7a8d', boxShadow: '0 4px 16px rgba(15,30,54,.06)' }}>
            No upcoming workshops right now — check back soon.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {events.map((e) => {
            const when = e.scheduled_at ? new Date(e.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) : 'Date TBA'
            return (
              <a
                key={e.workshop_id}
                href={`/events/${e.workshop_id}`}
                style={{ display: 'block', background: '#fff', borderRadius: 12, padding: 18, textDecoration: 'none', boxShadow: '0 4px 16px rgba(15,30,54,.06)', border: '1px solid #eef1f5' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <span style={{ fontSize: 26 }}>{TOPIC_ICON[e.topic] || '📅'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#0f1e36' }}>{e.title}</div>
                    <div style={{ fontSize: 13, color: '#4a5568', marginTop: 3 }}>📅 {when}</div>
                    {e.location && <div style={{ fontSize: 13, color: '#4a5568' }}>📍 {e.location}</div>}
                  </div>
                  <span style={{ color: '#2b6cb0', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>Register →</span>
                </div>
              </a>
            )
          })}
        </div>
      </div>
      <PublicFooter />
    </div>
  )
}
