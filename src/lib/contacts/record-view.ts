// src/lib/contacts/record-view.ts
// Pure, DB-free read model for the Contact Record workspace (/app/contacts/[id]).
//
// Everything the redesigned Contact View decides — which section is active, what
// counts as "needs attention", which appointment is next, how a due date buckets,
// how a DOB becomes an age — lives here so the server components stay composition
// only, and so the rules are provable offline (tests/contact-record-view.test.mjs).
//
// No imports. No clock reads except through an injected `now`, so every derivation
// is deterministic under test.

// ─── Sections ─────────────────────────────────────────────────────────────────

/**
 * The workspace's section shell. `overview` is the executive summary the FSA lands
 * on; the rest are depth. Sections are addressed by the `?s=` query param (not new
 * routes) so every section is deep-linkable and server-rendered.
 */
export const CONTACT_RECORD_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'notes', label: 'Notes' },
  { id: 'documents', label: 'Documents' },
  { id: 'profile', label: 'Profile' },
] as const

export type ContactRecordSection = (typeof CONTACT_RECORD_SECTIONS)[number]['id']

const SECTION_IDS = CONTACT_RECORD_SECTIONS.map((s) => s.id) as readonly string[]

export function toContactSection(value: string | undefined | null): ContactRecordSection {
  return value && SECTION_IDS.includes(value) ? (value as ContactRecordSection) : 'overview'
}

// ─── Identity derivations ─────────────────────────────────────────────────────

/**
 * Age in whole years from an ISO `YYYY-MM-DD` date of birth. Returns null for an
 * absent/unparseable DOB or a DOB in the future — the record shows the raw date
 * with no age rather than inventing one.
 */
export function ageFromDob(dob: string | null | undefined, now: number = Date.now()): number | null {
  if (!dob) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const today = new Date(now)
  let age = today.getUTCFullYear() - y
  const beforeBirthday =
    today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)
  if (beforeBirthday) age -= 1
  return age >= 0 && age < 130 ? age : null
}

/** Up to two initials for the monogram avatar. Falls back to '?' for a blank name. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

/** (972) 555-0147 for a 10-digit US number; the original string otherwise. */
export function formatPhone(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  const d = v.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return v
}

/** `tel:`/`sms:` target — E.164 when we can be confident, digits otherwise. */
export function dialHref(scheme: 'tel' | 'sms', raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length < 7) return null
  const e164 = d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : `+${d}`
  return `${scheme}:${e164}`
}

export function mailHref(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  return v.includes('@') ? `mailto:${v}` : null
}

// ─── Time / due-date buckets ──────────────────────────────────────────────────

export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none'

const DAY_MS = 86_400_000

/** Calendar-day comparison in the viewer's runtime zone (server renders in UTC). */
function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function dueBucket(dueAt: string | null | undefined, now: number = Date.now()): DueBucket {
  if (!dueAt) return 'none'
  const t = Date.parse(dueAt)
  if (Number.isNaN(t)) return 'none'
  if (dayKey(t) === dayKey(now)) return 'today'
  if (t < now) return 'overdue'
  return t - now <= 7 * DAY_MS ? 'soon' : 'later'
}

/** "in 3 days" / "4 days ago" / "today" — a relative label for a due or start date. */
export function relativeDay(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  if (dayKey(t) === dayKey(now)) return 'today'
  const days = Math.round((t - now) / DAY_MS)
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`
  const past = Math.abs(days)
  return `${past} day${past === 1 ? '' : 's'} ago`
}

// ─── Domain shapes (only the columns the record reads) ────────────────────────

export interface TaskRow {
  id: string
  title: string
  due_at: string | null
  completed: boolean
  source: string | null
  entity_type: string | null
}

export interface AppointmentRow {
  id: string
  scheduled_at: string | null
  starts_at?: string | null
  status: string
}

export interface OpportunityRow {
  id: string
  stage: string
  engagement: string | null
  is_security: boolean
  expected_commission: number | string | null
  face_amount: number | string | null
  updated_at: string | null
}

export interface PolicyRow {
  id: string
  policy_number: string | null
  product_name: string | null
  status: string
  is_security: boolean
  face_amount: number | string | null
}

export interface StreamRow {
  id: string
  kind: string | null
  note: string | null
  actor: string | null
  created_at: string
}

/** Stages that keep an opportunity in the working pipeline. */
export const CLOSED_OPPORTUNITY_STAGES = ['placed_issued', 'lost'] as const

export function isOpenOpportunity(stage: string): boolean {
  return !(CLOSED_OPPORTUNITY_STAGES as readonly string[]).includes(stage)
}

export function isOpenAppointment(a: AppointmentRow): boolean {
  return a.status === 'scheduled'
}

export function appointmentStart(a: AppointmentRow): number | null {
  const raw = a.starts_at ?? a.scheduled_at
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : t
}

/** The soonest still-scheduled appointment at or after `now`. */
export function nextAppointment(rows: AppointmentRow[], now: number = Date.now()): AppointmentRow | null {
  let best: AppointmentRow | null = null
  let bestAt = Infinity
  for (const a of rows) {
    if (!isOpenAppointment(a)) continue
    const t = appointmentStart(a)
    if (t == null || t < now) continue
    if (t < bestAt) {
      bestAt = t
      best = a
    }
  }
  return best
}

export function num(v: number | string | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export interface ContactSnapshot {
  coverageInForce: number
  activePolicies: number
  openOpportunities: number
  openPipelineValue: number
  openTasks: number
  overdueTasks: number
  lastTouchAt: string | null
}

export function summarizeContact(input: {
  policies: PolicyRow[]
  opportunities: OpportunityRow[]
  tasks: TaskRow[]
  stream: StreamRow[]
  now?: number
}): ContactSnapshot {
  const now = input.now ?? Date.now()
  const active = input.policies.filter((p) => p.status === 'active')
  const open = input.opportunities.filter((o) => isOpenOpportunity(o.stage))
  const openTasks = input.tasks.filter((t) => !t.completed)
  let lastTouchAt: string | null = null
  let lastMs = -Infinity
  for (const s of input.stream) {
    const t = Date.parse(s.created_at)
    if (Number.isFinite(t) && t <= now && t > lastMs) {
      lastMs = t
      lastTouchAt = s.created_at
    }
  }
  return {
    coverageInForce: active.reduce((sum, p) => sum + num(p.face_amount), 0),
    activePolicies: active.length,
    openOpportunities: open.length,
    openPipelineValue: open.reduce((sum, o) => sum + num(o.expected_commission), 0),
    openTasks: openTasks.length,
    overdueTasks: openTasks.filter((t) => dueBucket(t.due_at, now) === 'overdue').length,
    lastTouchAt,
  }
}

// ─── Attention ────────────────────────────────────────────────────────────────

export type AttentionTone = 'critical' | 'warning' | 'info'

export interface AttentionItem {
  key: string
  tone: AttentionTone
  label: string
  /** Where acting on it happens. Always a real destination — never a dead end. */
  href: string
  cta: string
}

/**
 * What the FSA must deal with, ranked. Only conditions the record can actually
 * evidence produce an item — no speculative "insights".
 */
export function deriveAttention(input: {
  contactId: string
  archived: boolean
  doNotContact: boolean
  tasks: TaskRow[]
  appointments: AppointmentRow[]
  opportunities: OpportunityRow[]
  openDocumentRequests: number
  hasContactChannel: boolean
  now?: number
}): AttentionItem[] {
  const now = input.now ?? Date.now()
  const items: AttentionItem[] = []
  const base = `/app/contacts/${input.contactId}`

  if (input.doNotContact) {
    items.push({
      key: 'dnc',
      tone: 'critical',
      label: 'On do-not-contact — excluded from automated outreach',
      href: '/app/comms/suppression',
      cta: 'Review suppression',
    })
  }

  const overdue = input.tasks.filter((t) => !t.completed && dueBucket(t.due_at, now) === 'overdue')
  if (overdue.length > 0) {
    items.push({
      key: 'tasks-overdue',
      tone: 'critical',
      label:
        overdue.length === 1
          ? `Task overdue — ${overdue[0].title}`
          : `${overdue.length} tasks overdue`,
      href: `${base}?s=tasks`,
      cta: 'Open tasks',
    })
  }

  const dueToday = input.tasks.filter((t) => !t.completed && dueBucket(t.due_at, now) === 'today')
  if (dueToday.length > 0) {
    items.push({
      key: 'tasks-today',
      tone: 'warning',
      label: dueToday.length === 1 ? `Due today — ${dueToday[0].title}` : `${dueToday.length} tasks due today`,
      href: `${base}?s=tasks`,
      cta: 'Open tasks',
    })
  }

  const missed = input.appointments.filter((a) => a.status === 'no_show')
  const upcoming = nextAppointment(input.appointments, now)
  const stale = input.appointments.filter(
    (a) => isOpenAppointment(a) && (appointmentStart(a) ?? Infinity) < now,
  )
  if (stale.length > 0) {
    items.push({
      key: 'appt-stale',
      tone: 'warning',
      label: `${stale.length} past appointment${stale.length === 1 ? '' : 's'} still marked scheduled`,
      href: '/app/calendar',
      cta: 'Update outcome',
    })
  }
  if (!upcoming && missed.length > 0) {
    items.push({
      key: 'appt-noshow',
      tone: 'warning',
      label: 'Missed appointment with nothing rebooked',
      href: `${base}?s=pipeline`,
      cta: 'Rebook',
    })
  }

  if (input.openDocumentRequests > 0) {
    items.push({
      key: 'docs',
      tone: 'warning',
      label: `${input.openDocumentRequests} outstanding document request${input.openDocumentRequests === 1 ? '' : 's'}`,
      href: `${base}?s=documents`,
      cta: 'Open documents',
    })
  }

  const openOpps = input.opportunities.filter((o) => isOpenOpportunity(o.stage))
  const stalled = openOpps.filter((o) => {
    const t = o.updated_at ? Date.parse(o.updated_at) : NaN
    return Number.isFinite(t) && now - t > 30 * DAY_MS
  })
  if (stalled.length > 0) {
    items.push({
      key: 'opp-stalled',
      tone: 'warning',
      label: `${stalled.length} open opportunit${stalled.length === 1 ? 'y has' : 'ies have'} not moved in 30+ days`,
      href: `${base}?s=pipeline`,
      cta: 'Open pipeline',
    })
  }

  if (!input.hasContactChannel && !input.archived) {
    items.push({
      key: 'no-channel',
      tone: 'warning',
      label: 'No phone or email on file — this contact cannot be reached',
      href: `${base}?s=profile`,
      cta: 'Add details',
    })
  }

  if (input.archived) {
    items.push({
      key: 'archived',
      tone: 'info',
      label: 'This contact is archived and hidden from working views',
      href: `${base}?s=profile`,
      cta: 'Open profile',
    })
  }

  return items
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export type TimelineFilter = 'all' | 'conversations' | 'meetings' | 'notes' | 'system'

/** Which filter chip a stream entry belongs to. Unknown kinds fall to `system`. */
export function timelineGroup(kind: string | null | undefined): Exclude<TimelineFilter, 'all'> {
  const k = (kind ?? '').toLowerCase()
  if (['call', 'sms', 'text', 'email', 'message', 'inbound', 'outbound', 'reply'].some((x) => k.includes(x))) {
    return 'conversations'
  }
  if (['appointment', 'meeting', 'review', 'booking'].some((x) => k.includes(x))) return 'meetings'
  if (k === 'note' || k.includes('note')) return 'notes'
  return 'system'
}

export function matchesTimelineFilter(kind: string | null | undefined, filter: TimelineFilter): boolean {
  return filter === 'all' || timelineGroup(kind) === filter
}

// ─── Reachability ─────────────────────────────────────────────────────────────

export type ChannelState = 'granted' | 'revoked' | 'suppressed' | 'unknown' | 'missing'

/**
 * Display-only channel state for the record's Reachability panel. This never
 * grants or denies a send — the dispatcher's gate remains the only authority; the
 * record simply shows the FSA what that gate currently sees.
 */
export function channelState(input: {
  hasAddress: boolean
  suppressed: boolean
  consent: 'granted' | 'revoked' | null
}): ChannelState {
  if (!input.hasAddress) return 'missing'
  if (input.suppressed) return 'suppressed'
  if (input.consent === 'revoked') return 'revoked'
  if (input.consent === 'granted') return 'granted'
  return 'unknown'
}

export const CHANNEL_STATE_LABEL: Record<ChannelState, string> = {
  granted: 'Consented',
  revoked: 'Opted out',
  suppressed: 'Suppressed',
  unknown: 'No consent',
  missing: 'Not on file',
}

/**
 * Display label for an activity/message `kind`. The raw column values are
 * machine tokens (`sms`, `consent_intent`, `appointment_booked`); a humanized
 * token reads as "Sms" / "Consent intent", which is not how an FSA speaks. Kinds
 * without an entry fall back to the shared `humanize` at the call site.
 */
export const STREAM_KIND_LABEL: Record<string, string> = {
  call: 'Call',
  sms: 'Text message',
  text: 'Text message',
  email: 'Email',
  note: 'Note',
  meeting: 'Meeting',
  appointment: 'Appointment',
  appointment_booked: 'Appointment booked',
  appointment_cancelled: 'Appointment cancelled',
  consent_intent: 'Consent captured',
  stage_change: 'Stage change',
  stage: 'Stage change',
  review: 'Review',
  import: 'Imported',
  document: 'Document',
}

/** Last 10 digits — the tolerant match the consent/DNC stores use. */
export function phoneTail(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').slice(-10)
}
