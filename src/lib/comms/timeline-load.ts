// src/lib/comms/timeline-load.ts
// Server-side loader for the unified comms/audit timeline. Reads are RLS-scoped through getDb()
// (via load()), so authorization is enforced at the store for whatever server context calls this —
// the same guarantee the appointment detail page and the P5.13 history page run under. Redaction is
// decided from the viewer's roles (revealFor) and applied inside the pure mappers, so a body,
// recipient, or provider id the role may not see is dropped before an entry is returned.
//
// Best-effort: a failing read degrades to an empty slice rather than throwing, so a comms outage
// never blanks the whole detail page.

import { load } from '@/lib/data/query'
import {
  mergeTimeline,
  revealFor,
  type TimelineEntry,
  type CommMessageRow,
  type CommEventRow,
  type AuditRow,
} from './timeline'

const MESSAGE_LIMIT = 200
const EVENT_LIMIT = 500
const AUDIT_LIMIT = 200

/**
 * Load the merged, redacted timeline for one entity. `roles` are the viewer's session roles; the
 * reveal capability is derived from them here (never from the client). Reusable across surfaces —
 * pass `{ entityType: 'appointment', entityId }` for P2.3, any entity for P5.13.
 */
export async function loadCommTimeline(
  entityType: string,
  entityId: string,
  roles: readonly string[],
): Promise<TimelineEntry[]> {
  const reveal = revealFor(roles)

  const msgsR = await load<CommMessageRow[]>(
    (db) =>
      db
        .from('comm_messages')
        .select('id, channel, direction, recipient, body, delivery_status, created_at')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_LIMIT),
    [],
  )
  const messages = msgsR.ok ? msgsR.data : []

  const ids = messages.map((m) => m.id)
  const evtsR = ids.length
    ? await load<CommEventRow[]>(
        (db) =>
          db
            .from('comm_message_events')
            .select('id, message_id, event, channel, detail, provider_id, created_at')
            .in('message_id', ids)
            .order('created_at', { ascending: false })
            .limit(EVENT_LIMIT),
        [],
      )
    : ({ ok: true as const, data: [] as CommEventRow[] })
  const events = evtsR.ok ? evtsR.data : []

  const auditR = await load<AuditRow[]>(
    (db) =>
      db
        .from('audit_log')
        .select('id, actor, action, diff, at')
        .eq('entity', entityType)
        .eq('entity_id', entityId)
        .order('at', { ascending: false })
        .limit(AUDIT_LIMIT),
    [],
  )
  const audits = auditR.ok ? auditR.data : []

  return mergeTimeline(messages, events, audits, reveal)
}
