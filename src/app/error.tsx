'use client'

import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="shell-gradient flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-16 text-center text-shell-foreground">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 text-destructive-foreground">
        <AlertTriangle className="h-7 w-7 text-[hsl(350_90%_72%)]" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="max-w-md text-sm leading-relaxed text-shell-muted">
        An unexpected error occurred. You can try again, and if the problem persists, reload the page.
      </p>
      {error?.digest && (
        <p className="font-mono text-xs text-shell-muted/70">Reference: {error.digest}</p>
      )}
      <Button onClick={() => reset()} className="mt-1">
        <RotateCw className="h-4 w-4" aria-hidden />
        Try again
      </Button>
    </main>
  )
}
