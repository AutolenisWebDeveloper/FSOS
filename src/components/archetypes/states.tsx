import * as React from 'react'
import { Inbox, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

/*
 * Shared archetype state building blocks (archetypes.md Definition of Done):
 * every page must ship empty + loading + error + success states. These are the
 * canonical, reusable implementations the A1–A13 shells compose.
 *
 * These are Server-Component-safe (no hooks, no event handlers): that is what
 * lets a Server Component page pass a lucide `icon` (a function/forwardRef) to
 * EmptyState. The one interactive state, ErrorState (onRetry → onClick), lives
 * in its own 'use client' module (./error-state) and is re-exported from the
 * archetypes barrel, so `import { ErrorState } from '@/components/archetypes'`
 * keeps working unchanged.
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
