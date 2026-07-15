'use client'

import * as React from 'react'
import { AlertTriangle, Inbox, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

/*
 * Shared archetype state building blocks (archetypes.md Definition of Done):
 * every page must ship empty + loading + error + success states. These are the
 * canonical, reusable implementations the A1–A13 shells compose.
 */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center', className)}
    >
      <Icon className="h-8 w-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

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

export function ForbiddenState({ description }: { description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border p-10 text-center">
      <ShieldAlert className="h-8 w-8 text-status-blocked" />
      <div className="space-y-1">
        <p className="font-medium">You don&apos;t have access to this</p>
        <p className="text-sm text-muted-foreground">
          {description ?? 'Your role does not permit this resource. If this is unexpected, contact an administrator.'}
        </p>
      </div>
    </div>
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  )
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  )
}

// ─── Status + assumption badges ───────────────────────────────────────────────

const STATUS_VARIANTS = {
  draft: 'draft',
  active: 'active',
  pending: 'pending',
  won: 'won',
  lost: 'lost',
  blocked: 'blocked',
  escalated: 'escalated',
} as const

export type StatusKey = keyof typeof STATUS_VARIANTS

export function StatusBadge({ status, label }: { status: StatusKey; label?: string }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{label ?? status}</Badge>
}

/**
 * The mandatory "config default — verify" badge for any un-verified Farmers value
 * (guardrail 3 / archetype A10). Rendering this is how the UI honors §2.3.
 */
export function AssumptionBadge({ label = 'config default — verify' }: { label?: string }) {
  return (
    <Badge variant="assumption" title="Not a Farmers-published figure. Editable default; verify against contract.">
      {label}
    </Badge>
  )
}
