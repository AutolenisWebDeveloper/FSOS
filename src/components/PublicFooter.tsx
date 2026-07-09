// Shared footer for public-facing pages (forms, uploads, events, legal).
// Keeps legal + opt-out links consistent and compliant across the site.

export default function PublicFooter() {
  const link: React.CSSProperties = { color: '#6b7a8d', textDecoration: 'none', margin: '0 8px' }
  return (
    <footer
      style={{
        marginTop: 28,
        padding: '16px 12px',
        textAlign: 'center',
        fontSize: 11,
        color: '#a0aec0',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
        lineHeight: 1.6,
      }}
    >
      <div>
        <a href="/privacy" style={link}>Privacy Policy</a>·
        <a href="/terms" style={link}>Terms of Service</a>·
        <a href="/unsubscribe" style={link}>Unsubscribe / Opt-Out</a>
      </div>
      <div style={{ marginTop: 6 }}>
        © {new Date().getFullYear()} Markist Athelus · Farmers Financial Services. Educational information only — not
        investment, tax, or legal advice.
      </div>
    </footer>
  )
}
