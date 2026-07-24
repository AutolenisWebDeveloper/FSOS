'use client'

import { useEffect } from 'react'
import { ListShell, ErrorState } from '@/components/archetypes'

// Hub-level error boundary for the AI Communications Center (§16/§21 — isolated,
// retryable error with a safe, generic message; no stack trace or internals shown to
// the operator). Scoped to the comms subtree so a failing surface recovers in place
// without blanking the rest of the app; the sub-navigation stays reachable.
export default function CommsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface for diagnosis (client console + any wired error tracking); never rendered.
    // eslint-disable-next-line no-console
    console.error('[comms] route error', error?.digest ?? '', error?.message ?? error)
  }, [error])

  return (
    <ListShell title="AI Communications Center" description="We couldn’t load this view.">
      <ErrorState
        title="Something went wrong loading this view"
        description="This is usually temporary. Try again, and if it keeps happening the issue has been logged for review."
        onRetry={reset}
      />
    </ListShell>
  )
}
