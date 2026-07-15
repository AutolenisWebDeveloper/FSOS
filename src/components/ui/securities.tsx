import * as React from 'react'
import { Landmark } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/*
 * FSOS securities firewall, made VISIBLE (docs/design-system.md §6; guardrail 1).
 * Any record flagged is_security is managed in the FFS-supervised system — FSOS
 * holds only a non-substantive reference pointer. These components surface that
 * so the firewall is obvious rather than invisible.
 */

/** Purple "FFS-MANAGED" chip for any is_security row/record. */
export function SecuritiesChip({ className }: { className?: string }) {
  return (
    <Badge variant="security" className={className}>
      FFS-managed
    </Badge>
  )
}

/**
 * Purple banner for the detail page of a securities record. FSOS may track that a
 * securities case exists but never stores account numbers, orders, suitability, or
 * securities communications (§2.1).
 */
export function SecuritiesBanner({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-md border border-status-security/40 bg-status-security/10 p-3 text-sm text-status-security',
        className,
      )}
    >
      <Landmark className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <p>
        <span className="font-medium">Securities record.</span> Managed in the FFS-supervised system.
        FSOS holds a reference only — no account numbers, orders, or suitability determinations.
      </p>
    </div>
  )
}

/** Left-border marker to apply to a securities row (compose with row classes). */
export const securitiesRowClass = 'border-l-2 border-l-status-security'
