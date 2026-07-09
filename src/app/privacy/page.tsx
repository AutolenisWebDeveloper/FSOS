import type { Metadata } from 'next'
import PublicFooter from '@/components/PublicFooter'

export const metadata: Metadata = { title: 'Privacy Policy — FSOS' }

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

export default function PrivacyPage() {
  return (
    <div style={{ background: '#f4f6f9', minHeight: '100vh' }}>
      <div style={page}>
        <h1 style={h1}>Privacy Policy</h1>
        <div style={{ fontSize: 13, color: '#6b7a8d', marginBottom: 20 }}>Last updated {LAST_UPDATED}</div>

        <p style={p}>
          This Privacy Policy explains how Markist Athelus, a licensed Farmers Financial Services agent based in
          McKinney, Texas (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;), collects, uses, and protects
          information you provide through our client tools, intake forms, workshop registrations, and communications.
        </p>

        <h2 style={h2}>Information we collect</h2>
        <p style={p}>
          We collect information you provide directly — such as your name, contact details, and the financial and
          household information you enter into our fact-finder and needs-analysis forms — as well as records of policies
          and interactions relevant to servicing your accounts. We also collect limited technical information (such as
          IP address) when you submit a form, to help secure and validate submissions.
        </p>

        <h2 style={h2}>How we use your information</h2>
        <p style={p}>
          We use your information to provide financial-services guidance, prepare needs analyses, service your policies,
          schedule appointments, and communicate with you. We do not sell your personal information.
        </p>

        <h2 style={h2}>Communications &amp; consent</h2>
        <p style={p}>
          With your consent, we may contact you by phone, SMS, and email. Message and data rates may apply. You can
          withdraw consent at any time by replying STOP to a text message, using the unsubscribe link in an email, or
          visiting our <a href="/unsubscribe" style={{ color: '#2b6cb0' }}>opt-out page</a>. Withdrawing consent does not
          affect servicing communications required for policies you hold.
        </p>

        <h2 style={h2}>How we store and protect your information</h2>
        <p style={p}>
          Your information is stored in access-controlled systems with encryption in transit. Documents you upload are
          kept in a private store and are never made publicly accessible. We retain information for as long as necessary
          to provide services and to meet legal, regulatory, and recordkeeping obligations.
        </p>

        <h2 style={h2}>Sharing</h2>
        <p style={p}>
          We share information only as needed to deliver services — for example, with Farmers Financial Services and its
          affiliated carriers and administrators, and with service providers who process communications and data on our
          behalf under confidentiality obligations — or where required by law.
        </p>

        <h2 style={h2}>Your choices</h2>
        <p style={p}>
          You may request access to, correction of, or deletion of your personal information, subject to legal and
          recordkeeping requirements. To make a request, contact us using the details below.
        </p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>
          Questions about this policy or your information? Contact Markist Athelus, Farmers Financial Services,
          McKinney, TX. This document is provided for transparency and is not legal advice.
        </p>
      </div>
      <PublicFooter />
    </div>
  )
}
