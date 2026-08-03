// src/lib/comms/timeline.ts
// PURE, dependency-free shaping for the unified communications + audit timeline. This is the
// REUSABLE read surface: the appointment detail (P2.3) and the communication-history / send-decision
// audit (P5.13) both feed rows through the SAME normalizer + merge here, then render the SAME
// <CommTimeline> view — neither forks a second timeline. The server loader (timeline-load.ts) does
// the RLS-scoped DB reads; this file stays clock-free and DB-free so the normalization, the
// role-based redaction, and the chronological merge are unit-provable in isolation.
//
// GUARDRAILS baked in here:
//   • Redaction is applied HERE, server-side, before an entry ever leaves for the client: a message
//     body, a recipient (PII), and a provider message id are dropped unless the viewer's role is
//     allowed to see them (revealFor). A redacted field is null in the entry — it is never shipped.
//   • The status union is a SUPERSET of today's delivery states. It already carries the send-decision
//     states P5.13 will emit (suppressed / not_eligible / quiet_hours_deferred) even though P2 has few
//     of them, so P5.13 extends this surface WITHOUT a reshape.

/**
 * Normalized timeline status — a superset of the comm_messages.delivery_status and
 * comm_message_events.event enums PLUS the dispatcher send-decision outcomes that the P5.13
 * history surfaces (a message the §12 gate suppressed, ruled not-eligible, or deferred out of
 * quiet hours). Extend this union, not the shape, when new outcomes appear.
 */
export type TimelineStatus =
  // delivery lifecycle (comm_messages.delivery_status + comm_message_events.event)
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'blocked'
  | 'complained'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'unsubscribed'
  // dispatcher send-decision outcomes (few today; first-class for P5.13)
  | 'suppressed'
  | 'not_eligible'
  | 'quiet_hours_deferred'

const KNOWN_STATUSES: ReadonlySet<string> = new Set<TimelineStatus>([
  'queued', 'sent', 'delivered', 'failed', 'bounced', 'blocked', 'complained',
  'opened', 'clicked', 'replied', 'unsubscribed',
  'suppressed', 'not_eligible', 'quiet_hours_deferred',
])

/** Coerce a raw delivery_status / event / decision string into the normalized union. Unknown
 *  values (should not occur — the DB CHECKs bound them) fall back to 'queued' defensively. */
export function normalizeStatus(raw: string | null | undefined): TimelineStatus {
  return raw && KNOWN_STATUSES.has(raw) ? (raw as TimelineStatus) : 'queued'
}

/** StatusBadge keys (mirrors archetypes StatusKey — kept as a local literal so this file imports
 *  nothing). The component casts these to StatusKey. */
export type TimelineBadgeKey = 'draft' | 'active' | 'pending' | 'won' | 'lost' | 'blocked' | 'escalated'

/** Map a normalized status to a badge key + human label. */
export function statusBadge(status: TimelineStatus): { key: TimelineBadgeKey; label: string } {
  switch (status) {
    case 'delivered':
      return { key: 'won', label: 'delivered' }
    case 'opened':
      return { key: 'active', label: 'opened' }
    case 'clicked':
      return { key: 'active', label: 'clicked' }
    case 'replied':
      return { key: 'active', label: 'replied' }
    case 'sent':
      return { key: 'pending', label: 'sent' }
    case 'queued':
      return { key: 'pending', label: 'queued' }
    case 'quiet_hours_deferred':
      return { key: 'pending', label: 'deferred (quiet hours)' }
    case 'failed':
      return { key: 'lost', label: 'failed' }
    case 'bounced':
      return { key: 'lost', label: 'bounced' }
    case 'complained':
      return { key: 'lost', label: 'complained' }
    case 'unsubscribed':
      return { key: 'blocked', label: 'unsubscribed' }
    case 'suppressed':
      return { key: 'blocked', label: 'suppressed' }
    case 'not_eligible':
      return { key: 'blocked', label: 'not eligible' }
    case 'blocked':
      return { key: 'blocked', label: 'blocked' }
  }
}

/** What a viewer's role is permitted to see. Decided server-side and passed into the mappers so
 *  redacted fields are dropped before an entry is built — never client-controllable. */
export interface TimelineReveal {
  /** See message bodies (and audit note text). */
  bodies: boolean
  /** See recipients (PII: phone / email). */
  recipients: boolean
  /** See provider message ids / SIDs (delivery forensics — operational/compliance only). */
  providerIds: boolean
}

// Role groups for redaction. Staff who legitimately read a client's comms see bodies + recipients;
// provider ids are delivery-forensics plumbing, shown only to operational/compliance/platform roles.
const BODY_ROLES = new Set(['fsa', 'licensed_staff', 'admin', 'compliance', 'supervisor', 'super_admin'])
const PROVIDER_ID_ROLES = new Set(['ops', 'compliance', 'supervisor', 'super_admin'])

/** Compute the reveal capability from the viewer's roles (server-side). */
export function revealFor(roles: readonly string[]): TimelineReveal {
  const canBodies = roles.some((r) => BODY_ROLES.has(r))
  return {
    bodies: canBodies,
    recipients: canBodies,
    providerIds: roles.some((r) => PROVIDER_ID_ROLES.has(r)),
  }
}

export type TimelineSource = 'message' | 'event' | 'audit'

export interface TimelineEntry {
  /** Stable key: `${source}:${rowId}`. */
  id: string
  /** ISO instant used for ordering + display. */
  at: string
  source: TimelineSource
  channel: 'sms' | 'email' | null
  direction: 'outbound' | 'inbound' | null
  status: TimelineStatus | null
  title: string
  /** Non-sensitive event detail (bounce reason, clicked URL) or an audit summary. */
  detail: string | null
  /** Message body — null unless reveal.bodies. */
  body: string | null
  /** Recipient PII — null unless reveal.recipients. */
  recipient: string | null
  /** Provider message id — null unless reveal.providerIds. */
  providerId: string | null
  /** Audit actor (who did it). */
  actor: string | null
}

// ─── Row shapes the mappers consume (a subset of the DB columns) ──────────────
export interface CommMessageRow {
  id: string
  channel: string | null
  direction: string | null
  recipient: string | null
  body: string | null
  delivery_status: string | null
  created_at: string
}
export interface CommEventRow {
  id: string
  event: string
  channel: string | null
  detail: string | null
  provider_id: string | null
  created_at: string
}
export interface AuditRow {
  id: number | string
  actor: string | null
  action: string
  diff: Record<string, unknown> | null
  at: string
}

function chan(c: string | null): 'sms' | 'email' | null {
  return c === 'sms' || c === 'email' ? c : null
}
function dir(d: string | null): 'outbound' | 'inbound' | null {
  return d === 'outbound' || d === 'inbound' ? d : null
}
function titleCase(s: string): string {
  return s.replace(/[._]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim()
}

/** A sent/received message → a timeline entry (body + recipient redacted per reveal). */
export function mapMessage(m: CommMessageRow, reveal: TimelineReveal): TimelineEntry {
  const channel = chan(m.channel)
  const direction = dir(m.direction)
  const status = normalizeStatus(m.delivery_status)
  const verb = direction === 'inbound' ? 'received' : statusBadge(status).label
  return {
    id: `message:${m.id}`,
    at: m.created_at,
    source: 'message',
    channel,
    direction,
    status,
    title: `${channel ? channel.toUpperCase() : 'Message'} ${verb}`,
    detail: null,
    body: reveal.bodies ? m.body : null,
    recipient: reveal.recipients ? m.recipient : null,
    providerId: null,
    actor: null,
  }
}

/** A delivery event → a timeline entry (provider id redacted per reveal). */
export function mapEvent(e: CommEventRow, reveal: TimelineReveal): TimelineEntry {
  const status = normalizeStatus(e.event)
  return {
    id: `event:${e.id}`,
    at: e.created_at,
    source: 'event',
    channel: chan(e.channel),
    direction: null,
    status,
    title: `Delivery: ${statusBadge(status).label}`,
    detail: e.detail,
    body: null,
    recipient: null,
    providerId: reveal.providerIds ? e.provider_id : null,
    actor: null,
  }
}

// Friendly timeline titles. A semantic `diff.event` (set by the writer) wins; then a per-action
// override; else the title-cased raw action. Keeps generic audit verbs (entity.updated/created)
// readable without leaking the raw diff.
const EVENT_TITLES: Record<string, string> = {
  note_added: 'Note added',
  task_created: 'Follow-up task created',
  rescheduled: 'Rescheduled',
}
const ACTION_TITLES: Record<string, string> = {
  'stage.changed': 'Status changed',
}

/** An audit record → a timeline entry. Raw diff is NOT dumped; a note is surfaced only when the
 *  viewer may see bodies, and a non-sensitive summary (e.g. a task title) otherwise. */
export function mapAudit(a: AuditRow, reveal: TimelineReveal): TimelineEntry {
  const event = a.diff && typeof a.diff.event === 'string' ? (a.diff.event as string) : null
  const note = reveal.bodies && a.diff && typeof a.diff.note === 'string' ? (a.diff.note as string) : null
  const summary = a.diff && typeof a.diff.title === 'string' ? (a.diff.title as string) : null
  return {
    id: `audit:${a.id}`,
    at: a.at,
    source: 'audit',
    channel: null,
    direction: null,
    status: null,
    title: (event && EVENT_TITLES[event]) || ACTION_TITLES[a.action] || titleCase(a.action),
    detail: note ?? summary,
    body: null,
    recipient: null,
    providerId: null,
    actor: a.actor,
  }
}

/**
 * Merge messages, delivery events, and audit records into one chronological timeline (newest
 * first). Redaction is applied per entry via `reveal`; ties break by source then id for a stable
 * order. This is the single merge both P2.3 and P5.13 call.
 */
export function mergeTimeline(
  messages: CommMessageRow[],
  events: CommEventRow[],
  audits: AuditRow[],
  reveal: TimelineReveal,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...messages.map((m) => mapMessage(m, reveal)),
    ...events.map((e) => mapEvent(e, reveal)),
    ...audits.map((a) => mapAudit(a, reveal)),
  ]
  return entries.sort((a, b) => {
    const cmp = b.at.localeCompare(a.at) // newest first
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id)
  })
}
