import type { Metadata } from 'next'
import PublicFooter from '@/components/PublicFooter'

export const metadata: Metadata = { title: 'Markist Athelus — Farmers Financial Services' }

// Public landing / booking page. Booking button points at NEXT_PUBLIC_CALENDLY_URL
// when configured, otherwise to the public workshops index.
const SERVICES = [
  { icon: '🏖️', title: 'Retirement planning', body: 'Strategies to help you plan for income and protection in retirement.' },
  { icon: '🛡️', title: 'Life insurance', body: 'Term and permanent coverage matched to your family and goals.' },
  { icon: '🔄', title: 'Term conversions', body: 'Review conversion options before your window closes.' },
  { icon: '📊', title: 'Financial reviews', body: 'A clear, no-pressure look at where you stand and your options.' },
]

export default function AboutPage() {
  const bookUrl = process.env.NEXT_PUBLIC_CALENDLY_URL || '/events'
  return (
    <div style={{ background: '#f4f6f9', minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg,#2b6cb0,#0f1e36)', color: '#fff', padding: '56px 22px 48px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.8 }}>Farmers Financial Services</div>
          <h1 style={{ fontSize: 36, fontWeight: 700, margin: '8px 0 10px' }}>Markist Athelus</h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, opacity: 0.92, maxWidth: 560 }}>
            A licensed Financial Services agent in McKinney, TX, helping families and business owners make confident,
            well-informed decisions about protection and retirement.
          </p>
          <div style={{ marginTop: 22, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href={bookUrl} style={{ background: '#e0b84c', color: '#0f1e3d', fontWeight: 700, fontSize: 15, padding: '12px 22px', borderRadius: 9, textDecoration: 'none' }}>
              Book a consultation
            </a>
            <a href="/events" style={{ background: 'rgba(255,255,255,.14)', color: '#fff', fontWeight: 600, fontSize: 15, padding: '12px 22px', borderRadius: 9, textDecoration: 'none' }}>
              See upcoming workshops
            </a>
          </div>
        </div>
      </div>

      {/* Services */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 22px', width: '100%', boxSizing: 'border-box', flex: 1 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f1e36', marginBottom: 18 }}>How I can help</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
          {SERVICES.map((s) => (
            <div key={s.title} style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 4px 16px rgba(15,30,54,.06)', border: '1px solid #eef1f5' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f1e36', marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: '#4a5568', lineHeight: 1.6 }}>{s.body}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 30, background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', boxShadow: '0 4px 16px rgba(15,30,54,.06)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0f1e36', marginBottom: 6 }}>Ready to talk?</div>
          <div style={{ fontSize: 14, color: '#4a5568', marginBottom: 16 }}>Schedule a free, no-obligation conversation about your goals.</div>
          <a href={bookUrl} style={{ background: '#2b6cb0', color: '#fff', fontWeight: 700, fontSize: 15, padding: '12px 26px', borderRadius: 9, textDecoration: 'none', display: 'inline-block' }}>
            Book a consultation
          </a>
        </div>

        <div style={{ marginTop: 20, fontSize: 12, color: '#a0aec0', textAlign: 'center', lineHeight: 1.6 }}>
          Educational information only — not investment, tax, or legal advice. Securities and insurance products are
          offered through Farmers Financial Services and its affiliated carriers.
        </div>
      </div>

      <PublicFooter />
    </div>
  )
}
