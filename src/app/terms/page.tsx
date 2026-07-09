import type { Metadata } from 'next'
import PublicFooter from '@/components/PublicFooter'

export const metadata: Metadata = { title: 'Terms of Service — FSOS' }

const LAST_UPDATED = 'July 9, 2026'

const page: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '40px 22px',
  fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
  color: '#1a2332',
  lineHeight: 1.7,
}
const h1: React.CSSProperties = { fontSize: 30, fontWeight: 700, color: '#0f1e36', marginBottom: 6 }
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: '#0f1e36', marginTop: 28, marginBottom: 8 }
const p: React.CSSProperties = { fontSize: 15, color: '#2d3748', marginBottom: 12 }

export default function TermsPage() {
  return (
    <div style={{ background: '#f4f6f9', minHeight: '100vh' }}>
      <div style={page}>
        <h1 style={h1}>Terms of Service</h1>
        <div style={{ fontSize: 13, color: '#6b7a8d', marginBottom: 20 }}>Last updated {LAST_UPDATED}</div>

        <p style={p}>
          These Terms govern your use of the client tools, forms, and workshop registration provided by Markist Athelus,
          a licensed Farmers Financial Services agent (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;). By using
          these tools, you agree to these Terms.
        </p>

        <h2 style={h2}>Educational information — not advice</h2>
        <p style={p}>
          Content provided through these tools is for general educational purposes only and is not investment, tax, or
          legal advice, and is not an offer or solicitation to buy or sell any product. Any recommendation regarding a
          specific product will be made only after a suitability review in accordance with applicable regulations,
          including FINRA Regulation Best Interest where relevant.
        </p>

        <h2 style={h2}>Accuracy of information</h2>
        <p style={p}>
          You agree that the information you provide is accurate and complete to the best of your knowledge. Analyses
          and illustrations depend on the information you supply and are estimates, not guarantees of any outcome, rate,
          or return.
        </p>

        <h2 style={h2}>Acceptable use</h2>
        <p style={p}>
          You agree to use these tools only for their intended purpose, not to submit unlawful or infringing content,
          and not to attempt to disrupt or gain unauthorized access to the systems.
        </p>

        <h2 style={h2}>Communications</h2>
        <p style={p}>
          By providing your contact information and consent, you agree we may contact you by phone, SMS, and email.
          You can opt out at any time — see our <a href="/unsubscribe" style={{ color: '#2b6cb0' }}>opt-out page</a> or
          our <a href="/privacy" style={{ color: '#2b6cb0' }}>Privacy Policy</a>.
        </p>

        <h2 style={h2}>Limitation of liability</h2>
        <p style={p}>
          To the extent permitted by law, we are not liable for indirect or consequential damages arising from your use
          of these tools. Nothing in these Terms limits obligations that cannot be limited under applicable law or the
          regulations governing financial-services professionals.
        </p>

        <h2 style={h2}>Changes</h2>
        <p style={p}>
          We may update these Terms from time to time. Continued use after an update constitutes acceptance of the
          revised Terms. This document is provided for transparency and is not legal advice.
        </p>
      </div>
      <PublicFooter />
    </div>
  )
}
