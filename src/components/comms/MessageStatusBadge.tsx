import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { deliveryStatus, gateOutcome } from '@/lib/comms/message-status'

/*
 * The two chips every comms surface needs, reading from one vocabulary
 * (lib/comms/message-status.ts) instead of seven inline ternaries that disagreed.
 * Server-Component-safe: no hooks, no handlers.
 */

/** `comm_messages.delivery_status` → chip. */
export function DeliveryStatusBadge({ status }: { status: string | null | undefined }) {
  const s = deliveryStatus(status)
  return (
    <Badge variant={s.variant} title={s.description}>
      {s.label}
    </Badge>
  )
}

/**
 * The gate result. Renders the *reason*, in advisor language, and distinguishes an
 * operational deferral (amber — retries itself) from a compliance block (red — a
 * human must act). Previously this cell printed a raw enum: `blocked: quiet_hours`.
 */
export function GateOutcomeBadge({
  blockedStep,
  consentAtSend,
  /** Suppress the chip on clean sends, for tables where only exceptions matter. */
  exceptionsOnly = false,
}: {
  blockedStep: string | null | undefined
  consentAtSend?: boolean | null
  exceptionsOnly?: boolean
}) {
  const outcome = gateOutcome({ blockedStep, consentAtSend })
  if (exceptionsOnly && outcome.tier === 'sent') return <span className="text-muted-foreground">—</span>
  return (
    <Badge variant={outcome.variant} title={outcome.description}>
      {outcome.label}
    </Badge>
  )
}
