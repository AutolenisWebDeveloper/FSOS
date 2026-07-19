export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '2rem',
        textAlign: 'center',
        background: '#0f1e3d',
        color: '#f5f7fb',
        fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: '2.5rem',
          fontWeight: 700,
          color: '#e0b84c',
          letterSpacing: '0.05em',
        }}
      >
        404
      </div>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
        Page not found
      </h1>
      <p style={{ margin: 0, opacity: 0.7, maxWidth: '28rem' }}>
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
    </main>
  )
}
