'use client'

// Catches errors thrown in the root layout itself (where the normal error.tsx
// boundary can't render). Must supply its own <html>/<body> and cannot rely on the
// app's font/class layer loading, so it is intentionally inline-styled — but every
// value is snapped to the FSOS design tokens (navy shell #0d2138, brand blue
// #0b5fcc, shell foreground) so it still reads as the same product.
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
          background: '#0d2138',
          color: '#eff3f8',
          fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>Something went wrong</div>
        <p style={{ margin: 0, maxWidth: '28rem', color: '#97a6b8', lineHeight: 1.6 }}>
          A server error occurred. Please try again — if the problem persists, reload the page or come back shortly.
        </p>
        {error?.digest && (
          <p style={{ margin: 0, color: '#97a6b8', opacity: 0.7, fontSize: '0.8rem', fontFamily: 'ui-monospace, monospace' }}>
            Reference: {error.digest}
          </p>
        )}
        <button
          onClick={() => reset()}
          style={{
            marginTop: '0.5rem',
            padding: '0.6rem 1.4rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            color: '#ffffff',
            background: '#0b5fcc',
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
