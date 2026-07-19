'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main
      style={{
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
      <div
        style={{
          fontSize: '2rem',
          fontWeight: 700,
          color: '#e0b84c',
        }}
      >
        Something went wrong
      </div>
      <p style={{ margin: 0, opacity: 0.7, maxWidth: '28rem' }}>
        An unexpected error occurred. You can try again, and if the problem
        persists, reload the page.
      </p>
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
    </main>
  )
}
