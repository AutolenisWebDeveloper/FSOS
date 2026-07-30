'use client'

import { useEffect } from 'react'
import { ListShell, ErrorState } from '@/components/archetypes'

// Portal-level error boundary (§16/§21 — isolated, retryable, generic message; no stack
// trace or internals shown). Scoped to this route group so an unexpected throw recovers
// in place inside the portal shell instead of bubbling to the root boundary and blanking
// the whole app.
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[client] route error', error?.digest ?? '', error?.message ?? error)
  }, [error])

  return (
    <ListShell title="Client Portal" description="We couldn’t load this view.">
      <ErrorState
        title="Something went wrong loading this view"
        description="This is usually temporary. Try again, and if it keeps happening the issue has been logged for review."
        onRetry={reset}
      />
    </ListShell>
  )
}
