// src/lib/workshops/comms-engine.ts
// P2 Workshop/Seminar comms ENGINE (impure orchestration). Two passes:
//   • runReminderPass  — pre-event confirmation + 7d/1d/1h reminders (spec §2.3)
//   • runNurturePass   — segmented post-event nurture off P1 attendance status (§2.4)
// Both run from the dedicated Vercel Cron route (/api/cron/workshop-reminders). Every
// client-facing send goes through the EXISTING dispatcher/gate (sendThroughGate) — there is
// no parallel sender here. Pure decisions live in ./reminders.ts; GHL routing reuses
// ./server.ts + ghl.ts; the referral spine reuses the same shape as the P1 convert route.
//
// GUARDRAILS enforced here:
//  - is_security firewall: securities workshops are EXCLUDED from selection; any that slip
//    through route to FFS via convertRegistrationToLead(is_security:true) — never a send.
//  - Consent: a channel is attempted ONLY when the registrant has a durable `granted` (not
//    later `revoked`) row for it in workshop_consent_events; that fact is passed to the gate
//    from the registration row (SETTLED model). DNC/STOP (gate step 3) is the independent opt-out backstop.
//  - Quiet-hours: recipient-local 9–20 is pre-checked as a scheduling DEFERRAL (retry next
//    tick, no escalation); the gate re-enforces it authoritatively at dispatch.
//  - Placeholder templates cannot activate: only an approved+active template with an
//    approved comm_templates gate handle is sendable; otherwise the slot is DEFERRED
//    (reason template_not_approved) and nothing is sent.
//  - Idempotency: workshop_message_log unique(reg,channel,kind) + an atomic claim means
//    overlapping cron ticks and retries produce at most one send per slot.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { sendThroughGate } from '@/lib/comms/send'
import { ianaZoneForPhone, utcOffsetHoursForZone } from '@/lib/comms/recipient-timezone'
import {
  convertRegistrationToLead,
  type WorkshopLeadContext,
} from './server'
import {
  isReminderClass,
  dueReminderKinds,
  segmentFor,
  nurtureKindForSegment,
  segmentTag,
  scoreDeltaForSegment,
  isNurtureDue,
  decideClaim,
  classifySendOutcome,
  recipientLocalHour,
  withinQuietHours,
  utcOffsetHoursForTimezone,
  buildCanSpamFooter,
  appendCanSpamFooter,
  type MessageKind,
  type Channel,
  type Segment,
  type LogStatus,
  type ScoreConfig,
  type ReminderKind,
} from './reminders'

type Db = ReturnType<typeof import('@/lib/supabase/client')['getDb']>

const ACTOR = 'agent:workshop-reminders'

// Lookahead: the widest before-start offset is 7d, so sessions up to ~8 days out are in
// scope for the reminder pass. Post-event nurture looks back a bounded window.
const REMINDER_LOOKAHEAD_MS = 8 * 24 * 60 * 60 * 1000
const NURTURE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000

export interface EngineConfig {
  enabled: boolean
  reminder_offsets_minutes: number[]
  confirmation_enabled: boolean
  nurture_delay_minutes: number
  sender_physical_address: string
  scores: ScoreConfig
}

const CONFIG_DEFAULTS: EngineConfig = {
  enabled: true,
  reminder_offsets_minutes: [10080, 1440, 60],
  confirmation_enabled: true,
  nurture_delay_minutes: 180,
  sender_physical_address: '[PLACEHOLDER - set the FSA business mailing address]',
  scores: { score_attended: 15, score_engaged: 25, score_no_show: -5, score_registered_no_show: -2, score_replay_viewed: 10 },
}

/** Load the singleton config row, falling back to code defaults if unset. */
async function loadConfig(db: Db): Promise<EngineConfig> {
  try {
    const { data } = await db.from('workshop_comms_config').select('*').eq('id', 'global').maybeSingle()
    if (!data) return CONFIG_DEFAULTS
    return {
      enabled: data.enabled !== false,
      reminder_offsets_minutes: Array.isArray(data.reminder_offsets_minutes) ? data.reminder_offsets_minutes : CONFIG_DEFAULTS.reminder_offsets_minutes,
      confirmation_enabled: data.confirmation_enabled !== false,
      nurture_delay_minutes: Number(data.nurture_delay_minutes ?? CONFIG_DEFAULTS.nurture_delay_minutes),
      sender_physical_address: data.sender_physical_address ?? CONFIG_DEFAULTS.sender_physical_address,
      scores: {
        score_attended: Number(data.score_attended ?? CONFIG_DEFAULTS.scores.score_attended),
        score_engaged: Number(data.score_engaged ?? CONFIG_DEFAULTS.scores.score_engaged),
        score_no_show: Number(data.score_no_show ?? CONFIG_DEFAULTS.scores.score_no_show),
        score_registered_no_show: Number(data.score_registered_no_show ?? CONFIG_DEFAULTS.scores.score_registered_no_show),
        score_replay_viewed: Number(data.score_replay_viewed ?? CONFIG_DEFAULTS.scores.score_replay_viewed),
      },
    }
  } catch {
    // WS-068 (fail closed): a config READ ERROR must not resurrect a possibly-disabled
    // engine — CONFIG_DEFAULTS has enabled:true, so returning it on error silently
    // re-enabled a deliberately-thrown kill switch. An unreadable config disables.
    return { ...CONFIG_DEFAULTS, enabled: false }
  }
}

// ── Kill switch ─────────────────────────────────────────────────────────────────
/** The engine is disabled when its env kill switch is set or its config row is disabled. */
function killSwitchOff(): boolean {
  return process.env.WORKSHOP_COMMS_DISABLED === '1'
}

// ── Shared row shapes ───────────────────────────────────────────────────────────

interface RegRow {
  reg_id: string
  name: string | null
  email: string | null
  phone: string | null
  consent_channels: string[] | null
  join_url: string | null
  /** Registration timestamp — the base table's column is registered_at (WS-001: the
   *  engine previously selected a nonexistent created_at and silently handled nobody). */
  registered_at: string | null
  /** SETTLED consent model: the ONE marketing fact, captured at signup (D-3). */
  marketing_opt_in: boolean | null
  status: string | null
  workshop_id: string
  session_id: string | null
  lead_converted_at: string | null
  referral_id: string | null
}

interface SessionRow {
  id: string
  workshop_id: string
  starts_at: string
  ends_at: string | null
  timezone: string | null
  venue_name: string | null
  venue_address: string | null
  status: string | null
}

interface WorkshopRow {
  workshop_id: string
  title: string | null
  slug: string | null
  is_security: boolean | null
  status: string | null
}

// ── Merge-token substitution (workshop-specific tokens; done BEFORE the dispatcher's
//    personalize(), which would otherwise blank unknown {{tokens}}) ────────────────

function appBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    ''
  return raw.replace(/\/$/, '')
}

function renderLocal(startsAt: string, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'America/Chicago',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(startsAt))
  } catch {
    return new Date(startsAt).toUTCString()
  }
}

function substituteTokens(body: string, tokens: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, token: string) => {
    const key = token.toLowerCase()
    // Leave the dispatcher-personalize name tokens for send.ts; substitute the known rest.
    if (key === 'first_name' || key === 'full_name' || key === 'last_name') return m
    // WS-032 (fail closed): an UNKNOWN token stays unresolved so the gate's
    // personalization step blocks the message — blanking it here disabled that check and
    // could ship a sentence with a silent hole.
    return key in tokens ? tokens[key] : m
  })
}

// ── Template selection (the placeholder gate) ───────────────────────────────────

interface SendableTemplate {
  id: string
  subject: string | null
  body: string
  comm_template_id: string
  disclosure_config_id: string | null
}

/**
 * Return a SENDABLE template for (kind, channel) — approved + active + with an approved
 * comm_templates gate handle. Returns null when only placeholders/drafts exist, which the
 * caller records as a DEFERRAL (template_not_approved) so nothing is sent until copy is
 * approved. For SMS, also requires an approved (non-placeholder) disclosure config.
 */
async function selectSendableTemplate(db: Db, kind: MessageKind, channel: Channel): Promise<SendableTemplate | null> {
  const { data } = await db
    .from('workshop_message_templates')
    .select('id, subject, body, comm_template_id, disclosure_config_id, status, active')
    .eq('kind', kind)
    .eq('channel', channel)
    .eq('status', 'approved')
    .eq('active', true)
    .not('comm_template_id', 'is', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data || !data.comm_template_id) return null
  if (channel === 'sms') {
    if (!data.disclosure_config_id) return null
    const { data: d } = await db
      .from('workshop_disclosure_configs')
      .select('is_assumption, approved_by')
      .eq('id', data.disclosure_config_id)
      .maybeSingle()
    if (!d || d.is_assumption !== false || !d.approved_by) return null
  }
  return {
    id: data.id,
    subject: data.subject,
    body: data.body,
    comm_template_id: data.comm_template_id,
    disclosure_config_id: data.disclosure_config_id,
  }
}

// ── Consent basis (SETTLED model, D-3) ──────────────────────────────────────────
// The registration row IS the consent record: the reminder class rides the registration
// itself; marketing (nurture) rides marketing_opt_in. No store is re-queried at send
// time — workshop_consent_events remains the CAPTURE-TIME evidence trail only, written
// by the registration route. DNC/STOP (gate step 3) is the independent opt-out backstop.

// ── One message send (shared by both passes) ────────────────────────────────────

export interface SendArgs {
  reg: RegRow
  workshop: WorkshopRow
  session: SessionRow | null
  kind: MessageKind
  channel: Channel
  config: EngineConfig
}

/**
 * Attempt one (reg, channel, kind) send through the gate, idempotently. Returns the log
 * status written. The claim is atomic (unique constraint) so overlapping ticks/retries
 * cannot double-send.
 */
export async function sendWorkshopMessage(db: Db, args: SendArgs): Promise<LogStatus> {
  const { reg, workshop, session, kind, channel, config } = args
  const to = channel === 'email' ? reg.email : reg.phone
  if (!to) return 'skipped'

  // Existing log → claim decision. WS-064: a read error must not claim blind — skip
  // this tick (audited) rather than risking a duplicate insert race on unknown state.
  const { data: existing, error: existingErr } = await db
    .from('workshop_message_log')
    .select('id, status, attempts')
    .eq('registration_id', reg.reg_id)
    .eq('channel', channel)
    .eq('kind', kind)
    .maybeSingle()
  if (existingErr) {
    await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, query: 'message_log', error: existingErr.message } })
    return 'skipped'
  }
  const decision = decideClaim((existing?.status as LogStatus | undefined) ?? null)
  if (decision === 'skip') return (existing?.status as LogStatus) ?? 'skipped'

  // Atomic claim: fresh insert, or a guarded update of a 'deferred' row (retry).
  let logId: string
  if (decision === 'claim') {
    const ins = await db
      .from('workshop_message_log')
      .insert({ registration_id: reg.reg_id, session_id: reg.session_id, channel, kind, status: 'sending' })
      .select('id')
      .maybeSingle()
    if (ins.error || !ins.data) {
      // Lost the race to a concurrent tick that inserted first → skip.
      return 'skipped'
    }
    logId = ins.data.id
  } else {
    // retry: only win if the row is still 'deferred'.
    const won = await db
      .from('workshop_message_log')
      .update({ status: 'sending', attempts: (existing?.attempts ?? 1) + 1, updated_at: new Date().toISOString() })
      .eq('id', existing!.id)
      .eq('status', 'deferred')
      .select('id')
      .maybeSingle()
    if (won.error || !won.data) return 'skipped'
    logId = existing!.id
  }

  const finalize = async (status: LogStatus, extra: { gate_blocked_step?: string | null; reason?: string | null; comm_message_id?: string | null }) => {
    await db
      .from('workshop_message_log')
      .update({ status, gate_blocked_step: extra.gate_blocked_step ?? null, reason: extra.reason ?? null, comm_message_id: extra.comm_message_id ?? null, updated_at: new Date().toISOString() })
      .eq('id', logId)
    return status
  }

  // Template gate (placeholder → deferred, never sent).
  const tpl = await selectSendableTemplate(db, kind, channel)
  if (!tpl) {
    await writeAudit({ actor: ACTOR, action: 'comms.deferred', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'template_not_approved' } })
    return finalize('deferred', { reason: 'template_not_approved' })
  }

  // SETTLED consent model (D-3): the consent fact is READ FROM THE REGISTRATION —
  // no store re-query, no re-arbitration. Registering IS consent for the reminder
  // class; every other kind (all nurture/marketing) requires the row's
  // marketing_opt_in. The closed REMINDER_CLASS enum is what keeps a marketing kind
  // from ever borrowing the registration basis.
  const consent = isReminderClass(kind) ? true : reg.marketing_opt_in === true
  if (!consent) {
    await writeAudit({ actor: ACTOR, action: 'comms.blocked', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'no_marketing_opt_in' } })
    return finalize('blocked', { gate_blocked_step: 'consent', reason: 'no_marketing_opt_in' })
  }

  // Quiet-hours scheduling pre-check, SMS ONLY — computed in the RECIPIENT's timezone
  // resolved from the phone's NPA (WS-005; Gate 1 decision: never venue TZ, never a
  // hardcoded default; unresolved → fail closed, no send). Email is exempt from the
  // quiet-hours floor (purpose.ts quietHoursApply) and keeps the venue offset for the
  // gate's context. Outside the window → defer (retry next tick); the deferral is
  // audited like its template/consent siblings (WS-065).
  const nowMs = Date.now()
  let utcOffset = utcOffsetHoursForTimezone(session?.timezone, nowMs)
  if (channel === 'sms') {
    const recipientZone = ianaZoneForPhone(to)
    const recipientOffset = recipientZone ? utcOffsetHoursForZone(recipientZone, nowMs) : null
    if (recipientOffset === null) {
      // Fail closed: no resolvable recipient zone → no send. Deferred (not blocked) so a
      // corrected phone number can still deliver before the event; the reminder window
      // itself bounds the retries.
      await writeAudit({ actor: ACTOR, action: 'comms.deferred', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'recipient_tz_unresolved' } })
      return finalize('deferred', { gate_blocked_step: 'quiet_hours', reason: 'recipient_tz_unresolved' })
    }
    utcOffset = recipientOffset
    const localHour = recipientLocalHour(nowMs, utcOffset)
    if (!withinQuietHours(localHour)) {
      await writeAudit({ actor: ACTOR, action: 'comms.deferred', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'outside_quiet_hours', recipient_zone: recipientZone, local_hour: localHour } })
      return finalize('deferred', { gate_blocked_step: 'quiet_hours', reason: 'outside_quiet_hours' })
    }
  }

  // Build the body (workshop tokens substituted here; name tokens left for personalize).
  const base = appBase()
  const tokens: Record<string, string> = {
    name: (reg.name ?? '').trim().split(/\s+/)[0] || 'there',
    workshop_title: workshop.title ?? 'the workshop',
    starts_local: session ? renderLocal(session.starts_at, session.timezone) : '',
    join_url: reg.join_url ?? (session ? `${base}/workshops/${workshop.slug ?? ''}/confirmed` : ''),
    venue: session?.venue_name || session?.venue_address || '',
    ics_url: base && workshop.slug ? `${base}/workshops/${workshop.slug}/confirmed` : '',
    confirmed_url: base && workshop.slug ? `${base}/workshops/${workshop.slug}/confirmed` : '',
    consult_url: base && workshop.slug ? `${base}/workshops/${workshop.slug}/replay` : '',
    replay_url: base && workshop.slug ? `${base}/workshops/${workshop.slug}/replay` : '',
  }
  let body = substituteTokens(tpl.body, tokens)
  let subject = tpl.subject ? substituteTokens(tpl.subject, tokens) : undefined

  // CAN-SPAM footer on commercial email (physical address + one-click unsubscribe).
  if (channel === 'email') {
    const unsub = base ? `${base}/unsubscribe?c=${encodeURIComponent(to)}&ch=email` : '/unsubscribe'
    body = appendCanSpamFooter(body, buildCanSpamFooter({ unsubscribeUrl: unsub, physicalAddress: config.sender_physical_address }))
  }

  // Dispatch through the SAME gate as everything else. durableConsentGranted feeds gate
  // step 1; isSecurity is false here (securities workshops are excluded upstream + route to
  // FFS). templateId is the approved comm_templates handle → gate step 4 passes.
  const outcome = await sendThroughGate({
    channel,
    to,
    subject,
    body,
    actor: ACTOR,
    templateId: tpl.comm_template_id,
    isSecurity: false,
    durableConsentGranted: consent,
    // Purpose taxonomy (existing platform machinery): reminder-class sends are
    // registration-derived event operations (TRANSACTIONAL); nurture is the WORKSHOP
    // marketing class. The engine's own recipient-local quiet-hours pre-check applies
    // to EVERY workshop SMS regardless (conservative operating setting).
    purpose: isReminderClass(kind) ? 'TRANSACTIONAL' : 'WORKSHOP',
    utcOffsetHours: utcOffset,
    entity: { type: 'workshop_registration', id: reg.reg_id },
    recipientContext: { full_name: reg.name },
  })

  const status = classifySendOutcome(outcome.sent, outcome.gate.blockedStep, (existing?.attempts ?? 0) + 1)
  return finalize(status, { gate_blocked_step: outcome.gate.blockedStep ?? null, reason: outcome.reason ?? null, comm_message_id: outcome.messageId ?? null })
}

// ── PASS 1: pre-event reminders ─────────────────────────────────────────────────

export interface PassResult {
  ok: boolean
  note?: string
  /** WS-064: query/send failures surfaced from the pass — non-empty means ok:false. */
  errors?: string[]
  handled: number
  sends: number
  deferred: number
  blocked: number
}

export async function runReminderPass(db: Db = getDb()): Promise<PassResult> {
  const config = await loadConfig(db)
  if (killSwitchOff() || !config.enabled) {
    return { ok: true, note: 'workshop comms disabled (kill switch)', handled: 0, sends: 0, deferred: 0, blocked: 0 }
  }
  const nowMs = Date.now()
  const windowEnd = new Date(nowMs + REMINDER_LOOKAHEAD_MS).toISOString()
  const windowStart = new Date(nowMs - 60 * 60 * 1000).toISOString() // include just-started (grace)

  // Upcoming, non-cancelled sessions on PUBLISHED, NON-securities workshops.
  // WS-064: every engine query reads its error — a selection failure is a FAILED pass,
  // never a silent { ok:true, handled:0 }.
  const errors: string[] = []
  const { data: sessions, error: sessionsErr } = await db
    .from('workshop_sessions')
    .select('id, workshop_id, starts_at, ends_at, timezone, venue_name, venue_address, status, workshop:workshops!inner(workshop_id, title, slug, is_security, status)')
    .gte('starts_at', windowStart)
    .lte('starts_at', windowEnd)
    .neq('status', 'cancelled')
  if (sessionsErr) {
    await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: 'reminder_pass', diff: { query: 'sessions', error: sessionsErr.message } })
    return { ok: false, errors: [`sessions: ${sessionsErr.message}`], handled: 0, sends: 0, deferred: 0, blocked: 0 }
  }
  const rows = (sessions ?? []) as unknown as (SessionRow & { workshop: WorkshopRow })[]

  let handled = 0
  let sends = 0
  let deferred = 0
  let blocked = 0

  for (const s of rows) {
    const workshop = s.workshop
    if (!workshop || workshop.status !== 'published' || workshop.is_security === true) continue

    const { data: regs, error: regsErr } = await db
      .from('workshop_registrations')
      .select('reg_id, name, email, phone, consent_channels, join_url, registered_at, marketing_opt_in, status, workshop_id, session_id, lead_converted_at, referral_id')
      .eq('session_id', s.id)
      .not('status', 'in', '("cancelled","ffs_referred")')
    if (regsErr) {
      await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: s.id, diff: { query: 'registrations', error: regsErr.message } })
      errors.push(`registrations(${s.id}): ${regsErr.message}`)
      continue
    }
    const regList = (regs ?? []) as RegRow[]

    for (const reg of regList) {
      const startMs = Date.parse(s.starts_at)
      const registeredMs = reg.registered_at ? Date.parse(reg.registered_at) : 0
      const kinds = dueReminderKinds({
        startMs,
        nowMs,
        registeredMs,
        offsetsMinutes: config.reminder_offsets_minutes,
        confirmationEnabled: config.confirmation_enabled,
      })
      for (const kind of kinds) {
        for (const channel of channelsForReminder(kind, reg)) {
          handled++
          // WS-027: one send's exception must not abort the whole pass (and must not
          // strand its claim in 'sending' — release it to a retryable deferral).
          try {
            const status = await sendWorkshopMessage(db, { reg, workshop, session: s, kind, channel, config })
            if (status === 'sent') sends++
            else if (status === 'deferred') deferred++
            else if (status === 'blocked') blocked++
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            errors.push(`send(${reg.reg_id},${channel},${kind}): ${msg}`)
            await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, error: msg } })
            await releaseStrandedClaim(db, reg.reg_id, channel, kind)
            deferred++
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, handled, sends, deferred, blocked }
}

/**
 * WS-027: a throw between the atomic claim and finalize would strand the slot in
 * 'sending' forever (decideClaim skips it). Release it to 'deferred' so the next tick
 * retries; guarded on status='sending' so a concurrent finalize is never clobbered.
 */
async function releaseStrandedClaim(db: Db, regId: string, channel: Channel, kind: MessageKind): Promise<void> {
  try {
    await db
      .from('workshop_message_log')
      .update({ status: 'deferred', reason: 'send_exception', updated_at: new Date().toISOString() })
      .eq('registration_id', regId)
      .eq('channel', channel)
      .eq('kind', kind)
      .eq('status', 'sending')
  } catch {
    /* release is best-effort; the claim row remains visible for a manual sweep */
  }
}

/**
 * Channels to attempt for a reminder kind — SETTLED model: registering IS consent for
 * reminders, so the only per-registrant filter is which contact details exist. Cadence
 * (spec §2.3): confirmation/7d = email; 1d/1h = email + SMS; starting = SMS.
 */
function channelsForReminder(kind: ReminderKind, reg: RegRow): Channel[] {
  const wants: Channel[] =
    kind === 'reminder_starting'
      ? ['sms']
      : kind === 'reminder_1d' || kind === 'reminder_1h'
        ? ['email', 'sms']
        : ['email']
  return wants.filter((c) => (c === 'email' ? !!reg.email : !!reg.phone))
}

// ── PASS 2: segmented post-event nurture ─────────────────────────────────────────

export async function runNurturePass(db: Db = getDb()): Promise<PassResult> {
  const config = await loadConfig(db)
  if (killSwitchOff() || !config.enabled) {
    return { ok: true, note: 'workshop comms disabled (kill switch)', handled: 0, sends: 0, deferred: 0, blocked: 0 }
  }
  const nowMs = Date.now()
  const lookbackStart = new Date(nowMs - NURTURE_LOOKBACK_MS).toISOString()
  const nurtureCutoff = new Date(nowMs - config.nurture_delay_minutes * 60_000).toISOString()

  // Recently-ended sessions whose nurture-delay has elapsed (WS-064: error surfaced).
  const errors: string[] = []
  const { data: sessions, error: sessionsErr } = await db
    .from('workshop_sessions')
    .select('id, workshop_id, starts_at, ends_at, timezone, venue_name, venue_address, status, workshop:workshops!inner(workshop_id, title, slug, is_security, status)')
    .gte('starts_at', lookbackStart)
    .lte('starts_at', nurtureCutoff)
  if (sessionsErr) {
    await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: 'nurture_pass', diff: { query: 'sessions', error: sessionsErr.message } })
    return { ok: false, errors: [`sessions: ${sessionsErr.message}`], handled: 0, sends: 0, deferred: 0, blocked: 0 }
  }
  const rows = (sessions ?? []) as unknown as (SessionRow & { workshop: WorkshopRow })[]

  let handled = 0
  let sends = 0
  let deferred = 0
  let blocked = 0

  for (const s of rows) {
    const workshop = s.workshop
    if (!workshop || workshop.status === 'draft') continue
    // Anchor the nurture trigger to session end (fallback start); require it elapsed.
    const anchorMs = s.ends_at ? Date.parse(s.ends_at) : Date.parse(s.starts_at)
    if (!isNurtureDue({ anchorMs, nowMs, delayMinutes: config.nurture_delay_minutes })) continue

    const { data: regs, error: regsErr } = await db
      .from('workshop_registrations')
      .select('reg_id, name, email, phone, consent_channels, join_url, registered_at, marketing_opt_in, status, workshop_id, session_id, lead_converted_at, referral_id')
      .eq('session_id', s.id)
      .is('nurtured_at', null)
      .not('status', 'in', '("cancelled","ffs_referred")')
    if (regsErr) {
      await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: s.id, diff: { query: 'nurture_registrations', error: regsErr.message } })
      errors.push(`nurture_registrations(${s.id}): ${regsErr.message}`)
      continue
    }
    const regList = (regs ?? []) as RegRow[]

    for (const reg of regList) {
      handled++
      // WS-027: one registrant's failure must not abort the nurture pass.
      try {
        // ── is_security firewall: never enter automated segments; route to FFS. ──
        if (workshop.is_security === true) {
          await routeSecuritiesToFfs(db, reg, workshop)
          await db.from('workshop_registrations').update({ nurture_segment: 'ffs', nurtured_at: new Date().toISOString() }).eq('reg_id', reg.reg_id)
          continue
        }

        // Segment from attendance status. WS-064: an attendance READ ERROR must not
        // misclassify a real attendee as registered_no_show — skip them this tick.
        const { data: att, error: attErr } = await db
          .from('workshop_attendance')
          .select('status')
          .eq('registration_id', reg.reg_id)
          .eq('session_id', s.id)
          .maybeSingle()
        if (attErr) {
          await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { query: 'attendance', error: attErr.message } })
          errors.push(`attendance(${reg.reg_id}): ${attErr.message}`)
          continue
        }
        const segment = segmentFor((att?.status as 'registered' | 'attended' | 'no_show' | 'left_early' | undefined) ?? null)
        const kind = nurtureKindForSegment(segment)

        // 1) Segment nurture message (gated per consented channel).
        for (const channel of channelsForNurture(segment, reg)) {
          const status = await sendWorkshopMessage(db, { reg, workshop, session: s, kind, channel, config })
          if (status === 'sent') sends++
          else if (status === 'deferred') deferred++
          else if (status === 'blocked') blocked++
        }

        // 2) Route into the consult spine + lead-score delta.
        const delta = scoreDeltaForSegment(segment, config.scores)
        await routeSegmentToSpine(db, reg, workshop, segment, delta)

        // 3) Mark nurtured (idempotency at the segment level).
        await db
          .from('workshop_registrations')
          .update({ nurture_segment: segment, nurtured_at: new Date().toISOString(), lead_score_delta: delta })
          .eq('reg_id', reg.reg_id)
        await writeAudit({ actor: ACTOR, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: { nurture_segment: segment, lead_score_delta: delta } })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`nurture(${reg.reg_id}): ${msg}`)
        await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { pass: 'nurture', error: msg } })
      }
    }
  }

  return { ok: errors.length === 0, errors, handled, sends, deferred, blocked }
}

/** SMS/email channels for a nurture segment — MARKETING tier: gated entirely by the
 *  registration row's marketing_opt_in (SETTLED model), then by which contact details
 *  exist. Email for all segments; SMS additionally for attended + no_show. */
function channelsForNurture(segment: Segment, reg: RegRow): Channel[] {
  if (reg.marketing_opt_in !== true) return []
  const wants: Channel[] = segment === 'no_show' || segment === 'attended' ? ['email', 'sms'] : ['email']
  return wants.filter((c) => (c === 'email' ? !!reg.email : !!reg.phone))
}

/** Securities workshop → FFS-supervised path (firewall). No message, no automated segment. */
async function routeSecuritiesToFfs(db: Db, reg: RegRow, workshop: WorkshopRow): Promise<void> {
  const ctx: WorkshopLeadContext = { is_security: true, slug: workshop.slug, title: workshop.title }
  await convertRegistrationToLead(
    db,
    { reg_id: reg.reg_id, name: reg.name, email: reg.email, phone: reg.phone, lead_converted_at: reg.lead_converted_at },
    ctx,
    ACTOR,
  )
  await writeAudit({ actor: ACTOR, action: 'firewall.blocked', entity: 'workshop_registration', entityId: reg.reg_id, diff: { nurture: 'securities_ffs' } })
}

// Segments that seed the internal referral + a Pipeline-A opportunity (the qualified
// consult candidates). No-show / registered-never-attended get the segment tag + score only.
function segmentIsQualified(segment: Segment): boolean {
  return segment === 'attended' || segment === 'left_early'
}

/**
 * Route a nurture segment into the existing consult spine (GHL excised — Pre-Phase-2):
 *   • qualified (attended/left_early): seed the internal referral (same shape as the manual
 *     convert route), then mark the native lead conversion via convertRegistrationToLead.
 *   • recapture (no_show/registered): the segment tag + lead-score delta are recorded on the
 *     registration by the nurture caller; there is no external push, so this is a native no-op.
 * The lead-score delta is stored on the registration (auditable). No external pipeline push.
 */
async function routeSegmentToSpine(db: Db, reg: RegRow, workshop: WorkshopRow, segment: Segment, _delta: number): Promise<void> {
  const tag = segmentTag(segment)

  if (segmentIsQualified(segment)) {
    // Seed the internal referral spine if not already present (mirrors the P1 route).
    if (!reg.referral_id) {
      const now = new Date()
      const { data: ref } = await db
        .from('referrals')
        .insert({
          referred_name: reg.name ?? 'Workshop attendee',
          referred_email: reg.email ?? null,
          referred_phone: reg.phone ?? null,
          engagement: 'direct',
          status: 'received',
          received_at: now.toISOString(),
          sla_due_at: new Date(now.getTime() + 24 * 3600000).toISOString(),
          owner_scope: ACTOR,
        })
        .select('id')
        .maybeSingle()
      if (ref?.id) {
        await db.from('workshop_registrations').update({ referral_id: ref.id }).eq('reg_id', reg.reg_id)
        await writeAudit({ actor: ACTOR, action: 'entity.created', entity: 'referral', entityId: ref.id, diff: { source: 'workshop_nurture', segment, registration_id: reg.reg_id } })
      }
    }
    // Mark the native conversion (securities-firewalled inside convert). The internal
    // referral above is the FSOS-native lead artifact; no external pipeline push (GHL excised).
    const outcome = await convertRegistrationToLead(
      db,
      { reg_id: reg.reg_id, name: reg.name, email: reg.email, phone: reg.phone, lead_converted_at: reg.lead_converted_at },
      { is_security: workshop.is_security === true, slug: workshop.slug, title: workshop.title },
      ACTOR,
      [tag],
    )
    if (outcome.ok && outcome.routed === 'native' && !outcome.skipped) {
      await writeAudit({ actor: ACTOR, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: { source: 'workshop_nurture', segment, converted: true } })
    }
    return
  }

  // Recapture segments (no_show / registered): the segment tag + lead-score delta are
  // recorded natively on the registration by the nurture caller. The former GHL contact
  // recapture push was removed in the excision; nothing native remains to do here.
}
