// src/lib/booking/config-history.ts
// PURE mapping of booking-config audit rows (action='config.changed' on the scheduling config
// tables) into the reusable timeline shape, so the settings page renders a "recent changes" history
// with the SAME <CommTimeline> view built in P2.3 — no second timeline. DB-free: the page does the
// audit_log read and feeds plain rows here. Type-only import of TimelineEntry keeps this unit-
// provable in isolation (compiled alongside comms/timeline.ts).

import type { TimelineEntry } from '../comms/timeline'

/** The scheduling-config entities whose `config.changed` audit rows form the settings history. */
export const BOOKING_CONFIG_ENTITIES = ['appointment_type', 'availability_rule', 'availability_blackout'] as const

const ENTITY_LABEL: Record<string, string> = {
  appointment_type: 'Appointment type',
  availability_rule: 'Weekly hours',
  availability_blackout: 'Blackout',
}

/** A booking-config audit row (the columns the mapper needs). */
export interface ConfigAuditRow {
  id: number | string
  actor: string | null
  entity: string
  diff: Record<string, unknown> | null
  at: string
}

/**
 * Human title for one config change, derived from the entity + the diff shape written by
 * lib/booking/config.ts (create → {created|name|weekday|starts_at}, update → {updated:[...]},
 * delete → {deleted:true}). Falls back to a neutral label/verb for anything unexpected.
 */
export function describeConfigChange(entity: string, diff: Record<string, unknown> | null): string {
  const label = ENTITY_LABEL[entity] ?? 'Scheduling setting'
  const d = diff ?? {}
  let verb = 'changed'
  if (d.deleted === true) verb = 'removed'
  else if ('updated' in d) verb = 'updated'
  else if ('created' in d || 'name' in d || 'weekday' in d || 'starts_at' in d) verb = 'added'
  return `${label} ${verb}`
}

/** Map a config audit row into a TimelineEntry (no bodies/PII — config changes carry none). */
export function toTimelineEntry(row: ConfigAuditRow): TimelineEntry {
  return {
    id: `audit:${row.id}`,
    at: row.at,
    source: 'audit',
    channel: null,
    direction: null,
    status: null,
    title: describeConfigChange(row.entity, row.diff),
    detail: null,
    body: null,
    recipient: null,
    providerId: null,
    actor: row.actor,
  }
}
