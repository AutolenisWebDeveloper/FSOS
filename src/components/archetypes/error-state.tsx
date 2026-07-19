'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/*
 * The one interactive archetype state: ErrorState carries an optional `onRetry`
 * handler, so it must be a Client Component. It is deliberately kept in its own
 * 'use client' module so the rest of the archetype states (states.tsx) stay
 * server-renderable — that lets Server Component pages pass a lucide `icon`
 * (a function/forwardRef, not serializable across the RSC boundary) to
 * EmptyState without tripping "Functions cannot be passed to Client Components".
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  className,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}) {
  // Inline card w/ status-lost left border (design-system.md §6): a single failing
  // widget shows this in place without blanking the surrounding page.
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-lg border border-l-2 border-status-lost/30 border-l-status-lost bg-status-lost/5 p-4',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-lost" strokeWidth={1.75} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  )
}
