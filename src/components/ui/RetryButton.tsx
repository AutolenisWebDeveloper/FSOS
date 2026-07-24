'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/*
 * Reusable transient-error retry control. Server Components can't hand a function
 * handler to ErrorState's `onRetry`, so they render this alongside the ErrorState:
 * a self-contained client button that re-runs the failed server render via
 * router.refresh(). Token-based styling only.
 */
export function RetryButton({ label = 'Try again' }: { label?: string }) {
  const router = useRouter()
  return (
    <Button variant="outline" size="sm" aria-label={label} onClick={() => router.refresh()}>
      {label}
    </Button>
  )
}
