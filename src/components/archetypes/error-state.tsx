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
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-10 text-center', className)}
    >
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
