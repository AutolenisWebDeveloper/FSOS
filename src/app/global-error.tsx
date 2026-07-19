'use client'

// Catches errors thrown in the root layout itself (where the normal error.tsx
// boundary can't render). Must supply its own <html>/<body>. Branded to match
// the rest of FSOS.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
          background: '#0f1e3d',
          color: '#f5f7fb',
          fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ fontSize: '2rem', fontWeight: 700, color: '#e0b84c' }}>Something went wrong</div>
        <p style={{ margin: 0, opacity: 0.7, maxWidth: '28rem' }}>
          A server error occurred. Please try again — if the problem persists, reload the page or come back shortly.
        </p>
        {error?.digest && (
          <p style={{ margin: 0, opacity: 0.4, fontSize: '0.8rem', fontFamily: 'monospace' }}>
            Reference: {error.digest}
          </p>
        )}
        <button
          onClick={() => reset()}
          style={{
            marginTop: '0.5rem',
            padding: '0.6rem 1.4rem',
            fontSize: '0.95rem',
            fontWeight: 600,
            color: '#0f1e3d',
            background: '#e0b84c',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
