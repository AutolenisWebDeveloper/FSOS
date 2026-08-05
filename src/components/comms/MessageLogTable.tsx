import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TimeCell } from '@/components/ui/time'
import { DeliveryStatusBadge, GateOutcomeBadge } from '@/components/comms/MessageStatusBadge'
import { needsAttention } from '@/lib/comms/message-status'
import { cn } from '@/lib/utils'

/*
 * ONE message log. /comms/sms and /comms/email were byte-for-byte the same 42-line
 * page apart from a channel filter and three strings; /comms (overview) and
 * /comms/delivery each carried a fourth and fifth near-copy of the same markup. Any
 * fix — the failed-reads-as-pending bug, the timezone bug, the double border — had
 * to be made five times, and in practice was made in one or two of them.
 *
 * Column set is composed rather than forked, so a channel-specific view drops the
 * redundant Channel column instead of maintaining its own table.
 *
 * Server-Component-safe.
 */

export interface MessageLogRow {
  id: string
  channel?: string | null
  direction?: string | null
  recipient?: string | null
  body?: string | null
  delivery_status: string
  blocked_step?: string | null
  block_reason?: string | null
  consent_at_send?: boolean | null
  created_at: string
}

export function MessageLogTable({
  rows,
  caption,
  showChannel = true,
  showDirection = true,
  showBody = false,
  showGate = true,
}: {
  rows: MessageLogRow[]
  /** Accessible table description. Visually hidden; read by screen readers. */
  caption: string
  showChannel?: boolean
  showDirection?: boolean
  showBody?: boolean
  showGate?: boolean
}) {
  return (
    <Table>
      <TableCaption srOnly>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">When</TableHead>
          {showChannel ? <TableHead scope="col">Channel</TableHead> : null}
          {showDirection ? <TableHead scope="col">Direction</TableHead> : null}
          <TableHead scope="col">Recipient</TableHead>
          {showBody ? <TableHead scope="col">Message</TableHead> : null}
          <TableHead scope="col">Delivery</TableHead>
          {showGate ? <TableHead scope="col">Gate</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => {
          const attention = needsAttention(m)
          return (
            <TableRow
              key={m.id}
              // A hairline marker rather than a filled row: exceptions stand out on a
              // scan without turning a busy log into a field of color.
              className={cn(attention && 'shadow-[inset_3px_0_0_0_hsl(var(--destructive))]')}
            >
              <TableCell className="text-muted-foreground">
                <TimeCell value={m.created_at} />
              </TableCell>
              {showChannel ? (
                <TableCell>
                  <Badge variant="outline">{m.channel ?? '—'}</Badge>
                </TableCell>
              ) : null}
              {showDirection ? (
                <TableCell>
                  <span className="text-xs text-muted-foreground">{m.direction ?? '—'}</span>
                </TableCell>
              ) : null}
              <TableCell className="max-w-[18rem] truncate text-muted-foreground" title={m.recipient ?? undefined}>
                {m.recipient ?? '—'}
              </TableCell>
              {showBody ? (
                <TableCell className="max-w-md truncate" title={m.body ?? undefined}>
                  {m.body ?? '—'}
                </TableCell>
              ) : null}
              <TableCell>
                <DeliveryStatusBadge status={m.delivery_status} />
              </TableCell>
              {showGate ? (
                <TableCell>
                  <GateOutcomeBadge blockedStep={m.blocked_step} consentAtSend={m.consent_at_send} />
                  {m.block_reason ? <p className="mt-1 text-xs text-muted-foreground">{m.block_reason}</p> : null}
                </TableCell>
              ) : null}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
