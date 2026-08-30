// src/lib/workshops/comms-engine.ts
// P2 Workshop/Seminar comms ENGINE (impure orchestration). Three passes:
//   • runReminderPass  — pre-event cadence (D-1(b)): 7d · 3d · 1d · day-of-AM ·
//     starting (virtual/hybrid). The engine 'confirmation' kind is DELETED (D-8): the
//     register route's instant transactional ack is the single confirmation of record.
//   • runChangePass    — reschedule/venue-change notices + event cancellations (WS-007/008)
//   • runNurturePass   — segmented post-event nurture + the T+2/3d follow-up (§2.4, D-1)
// All run from the dedicated Vercel Cron route (/api/cron/workshop-reminders). Every
// client-facing send goes through the EXISTING dispatcher/gate (sendMessage) — there is
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
//  - Idempotency: workshop_message_log unique(reg,channel,kind,cadence_generation) + an
//    atomic claim means overlapping cron ticks and retries produce at most one send per
//    slot; a material reschedule bumps the session generation, re-arming exactly the
//    re-armable kinds (WS-029) while one-time kinds stay pinned at generation 0.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { sendMessage } from '@/lib/comms/send'
import { resolveRecipientTimeZone } from '@/lib/comms/recipient-timezone'
import { localPartsInZone } from '@/lib/comms/dispatch-policy'
import {
  convertRegistrationToLead,
  PLACEHOLDER_MARKER,
  type WorkshopLeadContext,
} from './server'
import {
  isReminderClass,
  claimGeneration,
  dueReminderKinds,
  unmappedOffsets,
  isFollowupDue,
  toPlainText,
  segmentFor,
  nurtureKindForSegment,
  segmentTag,
  scoreDeltaForSegment,
  isNurtureDue,
  decideClaim,
  classifySendOutcome,
  recipientLocalHour,
  withinQuietHours,
  buildCanSpamFooter,
  appendCanSpamFooter,
  type MessageKind,
  type Channel,
  type ChangeKind,
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

// WS-031: per-tick work is BOUNDED and deterministic (order starts_at / registered_at).
// A tick that hits a bound simply leaves the remainder for the next tick — claims make
// that safe; nothing is skipped forever.
const SESSIONS_PER_TICK = 200
const REGS_PER_SESSION = 1000

export interface EngineConfig {
  enabled: boolean
  reminder_offsets_minutes: number[]
  nurture_delay_minutes: number
  /** T+2/3d follow-up delay after the session anchor (D-1 pairing; default 2 days). */
  nurture_followup_delay_minutes: number
  sender_physical_address: string
  scores: ScoreConfig
}

const CONFIG_DEFAULTS: EngineConfig = {
  enabled: true,
  // D-1(b) cadence offsets: 7d · 3d · 1d · starting (0 — virtual/hybrid only, gated in
  // dueReminderKinds). Day-of-AM is wall-clock, not an offset. The engine 'confirmation'
  // kind is DELETED (D-8): the register route's instant ack is the confirmation of record.
  reminder_offsets_minutes: [10080, 4320, 1440, 0],
  nurture_delay_minutes: 180,
  nurture_followup_delay_minutes: 2880,
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
      nurture_delay_minutes: Number(data.nurture_delay_minutes ?? CONFIG_DEFAULTS.nurture_delay_minutes),
      nurture_followup_delay_minutes: Number(data.nurture_followup_delay_minutes ?? CONFIG_DEFAULTS.nurture_followup_delay_minutes),
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

/** The registration columns every pass (and the cancel-ack sender) selects. */
const REG_COLS = 'reg_id, name, email, phone, consent_channels, join_url, join_token, registered_at, marketing_opt_in, status, workshop_id, session_id, lead_converted_at, referral_id'

interface RegRow {
  reg_id: string
  name: string | null
  email: string | null
  phone: string | null
  consent_channels: string[] | null
  join_url: string | null
  /** The registrant's stable manage/cancel identity (drives the {{cancel_url}} token —
   *  WS-009). Distinct from join_url (the Zoom link, cleared on cancellation). */
  join_token: string | null
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
  delivery_mode: string | null
  venue_name: string | null
  venue_address: string | null
  status: string | null
  /** WS-029: the re-arm key — bumped by a material reschedule/venue change. */
  cadence_generation: number | null
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
  /** WS-031: a per-session prefetch of existing send-log rows (key: logKey()). When
   *  provided, the existing-row read uses it instead of a per-slot select. The CLAIM
   *  itself stays atomic (insert / guarded update) — a stale hint just loses the race
   *  and skips, exactly like the un-hinted path. */
  prefetch?: Map<string, { id: string; status: string; attempts: number | null }>
}

/** The prefetch key for one send slot. */
export function logKey(regId: string, channel: string, kind: string, generation: number): string {
  return `${regId}|${channel}|${kind}|${generation}`
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

  // WS-029: the claim slot is generation-scoped. Re-armable kinds key on the session's
  // CURRENT cadence_generation (a reschedule bump = a fresh slot); one-time kinds pin
  // to generation 0 forever so a reschedule can never replay them.
  const generation = claimGeneration(kind, session?.cadence_generation)

  // Existing log → claim decision. WS-031: with a per-session prefetch, this is a map
  // lookup instead of a per-slot select. WS-064 (un-hinted path): a read error must not
  // claim blind — skip this tick (audited) rather than risking a duplicate insert race
  // on unknown state.
  let existing: { id: string; status: string; attempts: number | null } | null
  if (args.prefetch) {
    existing = args.prefetch.get(logKey(reg.reg_id, channel, kind, generation)) ?? null
  } else {
    const { data, error: existingErr } = await db
      .from('workshop_message_log')
      .select('id, status, attempts')
      .eq('registration_id', reg.reg_id)
      .eq('channel', channel)
      .eq('kind', kind)
      .eq('cadence_generation', generation)
      .maybeSingle()
    if (existingErr) {
      await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, query: 'message_log', error: existingErr.message } })
      return 'skipped'
    }
    existing = (data ?? null) as { id: string; status: string; attempts: number | null } | null
  }
  const decision = decideClaim((existing?.status as LogStatus | undefined) ?? null)
  if (decision === 'skip') return (existing?.status as LogStatus) ?? 'skipped'

  // Atomic claim: fresh insert, or a guarded update of a 'deferred' row (retry).
  let logId: string
  if (decision === 'claim') {
    const ins = await db
      .from('workshop_message_log')
      .insert({ registration_id: reg.reg_id, session_id: reg.session_id, channel, kind, status: 'sending', cadence_generation: generation })
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
  //
  // ADOPTS MAIN'S CHOKEPOINT. This engine no longer computes a UTC OFFSET for the
  // recipient. main's dispatch policy resolves the local hour from an IANA ZONE via
  // Intl (dispatch-policy.localPartsInZone), which is DST-correct and — unlike an
  // hours-rounded offset — exact in half-hour zones. The branch's own
  // utcOffsetHoursForZone rounded (Math.round), which put America/St_Johns 30 minutes
  // fast and could open an 08:30–09:00 recipient-local send window; deleting that helper
  // in favour of main's resolver removes the defect rather than patching it.
  const nowMs = Date.now()
  let recipientZone: string | null = null
  if (channel === 'sms') {
    const resolution = resolveRecipientTimeZone({ phone: to, zip: null })
    if (!resolution.resolved) {
      // Fail closed, unchanged: no resolvable recipient zone → no send. Deferred (not
      // blocked) so a corrected phone number can still deliver before the event; the
      // reminder window itself bounds the retries.
      await writeAudit({ actor: ACTOR, action: 'comms.deferred', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'recipient_tz_unresolved' } })
      return finalize('deferred', { gate_blocked_step: 'quiet_hours', reason: 'recipient_tz_unresolved' })
    }
    recipientZone = resolution.timeZone
    const localHour = localPartsInZone(recipientZone, new Date(nowMs)).hour
    if (!withinQuietHours(localHour)) {
      await writeAudit({ actor: ACTOR, action: 'comms.deferred', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'outside_quiet_hours', recipient_zone: recipientZone, local_hour: localHour } })
      return finalize('deferred', { gate_blocked_step: 'quiet_hours', reason: 'outside_quiet_hours' })
    }
  }

  // Build the body (workshop tokens substituted here; name tokens left for personalize).
  const base = appBase()
  // WS-034 (fail closed): with no configured app URL, every URL this email carries —
  // the CAN-SPAM one-click unsubscribe above all — degrades to a relative, non-working
  // link. That is a deployment-config error, not a reason to ship broken mail: DEFER
  // (retryable the moment the env var exists), audited like its siblings.
  if (channel === 'email' && !base) {
    await writeAudit({ actor: ACTOR, action: 'comms.deferred', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'app_url_unconfigured' } })
    return finalize('deferred', { reason: 'app_url_unconfigured' })
  }
  // WS-025 (fail closed): COMMERCIAL email must carry the sender's real physical
  // mailing address (CAN-SPAM). While the config still holds the placeholder, the
  // marketing tier DEFERS — retryable the moment the FSA supplies the address (a
  // go-live checklist item). Transactional reminder-class receipts are not commercial
  // mail and are not held hostage to a marketing config item.
  if (channel === 'email' && !isReminderClass(kind) && config.sender_physical_address.includes(PLACEHOLDER_MARKER)) {
    await writeAudit({ actor: ACTOR, action: 'comms.deferred', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'sender_address_placeholder' } })
    return finalize('deferred', { reason: 'sender_address_placeholder' })
  }
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
    // WS-009: the registrant's own cancel link (token-addressed manage flow). Available
    // to every template; the copy decides where it appears (FFS approval owns copy).
    cancel_url: base && reg.join_token ? `${base}/workshops/cancel?token=${encodeURIComponent(reg.join_token)}` : '',
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
  const outcome = await sendMessage({
    channel,
    to,
    subject,
    body,
    // WS-067: every workshop email carries a real text/plain part (deliverability +
    // the repo's own email-QA standard). Derived from the final HTML, footer included.
    bodyText: channel === 'email' ? toPlainText(body) : undefined,
    actor: ACTOR,
    templateId: tpl.comm_template_id,
    isSecurity: false,
    durableConsentGranted: consent,
    // Purpose taxonomy (existing platform machinery): reminder-class sends are
    // registration-derived event operations (TRANSACTIONAL); nurture is the WORKSHOP
    // marketing class. The engine's own recipient-local quiet-hours pre-check applies
    // to EVERY workshop SMS regardless (conservative operating setting).
    purpose: isReminderClass(kind) ? 'TRANSACTIONAL' : 'WORKSHOP',
    // An IANA ZONE, never an offset — main's chokepoint resolves the local hour from it
    // exactly (localPartsInZone) and reports the resolution as non-approximate. SMS
    // carries the RECIPIENT's zone (resolved above, fail-closed); email is exempt from
    // the quiet-hours floor and carries the venue's zone purely as gate context.
    timeZone: channel === 'sms' ? (recipientZone ?? undefined) : (session?.timezone ?? undefined),
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

  // A configured offset the cadence does not model is a VISIBLE config defect (logged
  // once per pass), never a silent drop.
  const stray = unmappedOffsets(config.reminder_offsets_minutes)
  if (stray.length) {
    console.warn('[workshop-reminders] config offsets with no cadence kind (skipped):', stray.join(', '))
  }

  // Upcoming, non-cancelled sessions on PUBLISHED, NON-securities workshops.
  // WS-064: every engine query reads its error — a selection failure is a FAILED pass,
  // never a silent { ok:true, handled:0 }.
  const errors: string[] = []
  const { data: sessions, error: sessionsErr } = await db
    .from('workshop_sessions')
    .select('id, workshop_id, starts_at, ends_at, timezone, delivery_mode, venue_name, venue_address, status, cadence_generation, workshop:workshops!inner(workshop_id, title, slug, is_security, status)')
    .gte('starts_at', windowStart)
    .lte('starts_at', windowEnd)
    .neq('status', 'cancelled')
    .order('starts_at', { ascending: true })
    .limit(SESSIONS_PER_TICK)
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
      .select(REG_COLS)
      .eq('session_id', s.id)
      .not('status', 'in', '("cancelled","ffs_referred")')
      .order('registered_at', { ascending: true })
      .limit(REGS_PER_SESSION)
    if (regsErr) {
      await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: s.id, diff: { query: 'registrations', error: regsErr.message } })
      errors.push(`registrations(${s.id}): ${regsErr.message}`)
      continue
    }
    const regList = (regs ?? []) as RegRow[]

    // WS-031: ONE batched send-log read per session replaces the per-slot lookups
    // (kinds × channels × registrants selects). The atomic claim below is untouched —
    // a stale prefetch entry just loses its race and skips.
    let prefetch: Map<string, { id: string; status: string; attempts: number | null }> | undefined
    if (regList.length > 0) {
      const { data: logRows, error: logErr } = await db
        .from('workshop_message_log')
        .select('id, status, attempts, registration_id, channel, kind, cadence_generation')
        .in('registration_id', regList.map((r) => r.reg_id))
      if (logErr) {
        // WS-064: an unreadable log must not claim blind for a whole session — skip it
        // this tick (audited); the next tick retries.
        await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: s.id, diff: { query: 'message_log_prefetch', error: logErr.message } })
        errors.push(`message_log_prefetch(${s.id}): ${logErr.message}`)
        continue
      }
      prefetch = new Map()
      for (const row of (logRows ?? []) as { id: string; status: string; attempts: number | null; registration_id: string; channel: string; kind: string; cadence_generation: number | null }[]) {
        prefetch.set(logKey(row.registration_id, row.channel, row.kind, row.cadence_generation ?? 0), { id: row.id, status: row.status, attempts: row.attempts })
      }
    }

    for (const reg of regList) {
      const startMs = Date.parse(s.starts_at)
      const registeredMs = reg.registered_at ? Date.parse(reg.registered_at) : 0
      const kinds = dueReminderKinds({
        startMs,
        nowMs,
        registeredMs,
        offsetsMinutes: config.reminder_offsets_minutes,
        venueZone: s.timezone,
        deliveryMode: s.delivery_mode,
      })
      for (const kind of kinds) {
        for (const channel of channelsForReminder(kind, reg)) {
          handled++
          // WS-027: one send's exception must not abort the whole pass (and must not
          // strand its claim in 'sending' — release it to a retryable deferral).
          try {
            const status = await sendWorkshopMessage(db, { reg, workshop, session: s, kind, channel, config, prefetch })
            if (status === 'sent') sends++
            else if (status === 'deferred') deferred++
            else if (status === 'blocked') blocked++
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            errors.push(`send(${reg.reg_id},${channel},${kind}): ${msg}`)
            await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, error: msg } })
            await releaseStrandedClaim(db, reg.reg_id, channel, kind, claimGeneration(kind, s.cadence_generation))
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
async function releaseStrandedClaim(db: Db, regId: string, channel: Channel, kind: MessageKind, generation: number): Promise<void> {
  try {
    await db
      .from('workshop_message_log')
      .update({ status: 'deferred', reason: 'send_exception', updated_at: new Date().toISOString() })
      .eq('registration_id', regId)
      .eq('channel', channel)
      .eq('kind', kind)
      .eq('cadence_generation', generation)
      .eq('status', 'sending')
  } catch {
    /* release is best-effort; the claim row remains visible for a manual sweep */
  }
}

/**
 * Channels to attempt for a reminder kind — SETTLED model: registering IS consent for
 * reminders, so the only per-registrant filter is which contact details exist. D-1(b)
 * cadence: 7d = email · 3d = email+SMS · 1d = email+SMS · day-of-AM = SMS · starting =
 * SMS (virtual/hybrid only — gated upstream in dueReminderKinds). The legacy 1h
 * capability keeps email+SMS.
 */
function channelsForReminder(kind: ReminderKind, reg: RegRow): Channel[] {
  const wants: Channel[] =
    kind === 'reminder_starting' || kind === 'reminder_day_of'
      ? ['sms']
      : kind === 'reminder_3d' || kind === 'reminder_1d' || kind === 'reminder_1h'
        ? ['email', 'sms']
        : ['email']
  return wants.filter((c) => (c === 'email' ? !!reg.email : !!reg.phone))
}

// ── PASS: lifecycle change notices (WS-007 / WS-008) ─────────────────────────────

/** How far back a cancelled session still triggers notices — a session cancelled after
 *  it already ended notifies nobody. Mirrors the reminder pass's just-started grace. */
const CANCEL_NOTICE_GRACE_MS = 60 * 60 * 1000

/** Channels for a lifecycle notice: transactional service messages about the
 *  registrant's own signup ride BOTH channels where the contact detail exists (the
 *  dispatcher gate still enforces STOP/DNC + quiet hours on the SMS). */
function channelsForChange(reg: RegRow): Channel[] {
  const out: Channel[] = []
  if (reg.email) out.push('email')
  if (reg.phone) out.push('sms')
  return out
}

/**
 * Announce session lifecycle changes to affected registrants, claimed through the SAME
 * send path as every other kind (one claim per registrant/channel/kind/generation):
 *   • sessions with a pending change_kind (reschedule/venue) on a PUBLISHED workshop →
 *     that notice to every active registrant who signed up BEFORE the change was
 *     recorded (later registrants saw the new details on the signup page);
 *   • cancelled sessions (any once-published workshop — the workshop may itself now be
 *     'cancelled', which is what the WS-008 cascade produces) → event_cancelled to
 *     every active registrant.
 * Securities workshops stay excluded (standing firewall: nothing automated).
 * Claims key on the session's CURRENT cadence_generation, so a second reschedule
 * (new generation) legitimately notifies again while re-ticks stay deduped.
 */
export async function runChangePass(db: Db = getDb()): Promise<PassResult> {
  const config = await loadConfig(db)
  if (killSwitchOff() || !config.enabled) {
    return { ok: true, note: 'workshop comms disabled (kill switch)', handled: 0, sends: 0, deferred: 0, blocked: 0 }
  }
  const nowMs = Date.now()
  const horizon = new Date(nowMs - CANCEL_NOTICE_GRACE_MS).toISOString()

  const errors: string[] = []
  let handled = 0
  let sends = 0
  let deferred = 0
  let blocked = 0

  // One query covers both triggers; classified per row below. WS-064: error surfaced.
  const { data: sessions, error: sessionsErr } = await db
    .from('workshop_sessions')
    .select('id, workshop_id, starts_at, ends_at, timezone, delivery_mode, venue_name, venue_address, status, cadence_generation, change_kind, change_recorded_at, workshop:workshops!inner(workshop_id, title, slug, is_security, status)')
    .gte('starts_at', horizon)
    .or('status.eq.cancelled,change_kind.not.is.null')
    .order('starts_at', { ascending: true })
    .limit(SESSIONS_PER_TICK)
  if (sessionsErr) {
    await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: 'change_pass', diff: { query: 'sessions', error: sessionsErr.message } })
    return { ok: false, errors: [`sessions: ${sessionsErr.message}`], handled: 0, sends: 0, deferred: 0, blocked: 0 }
  }
  const rows = (sessions ?? []) as unknown as (SessionRow & { change_kind: string | null; change_recorded_at: string | null; workshop: WorkshopRow })[]

  for (const s of rows) {
    const workshop = s.workshop
    if (!workshop || workshop.is_security === true) continue

    // Classify: a cancelled session announces the cancellation (and its stale pending
    // change, if any, is moot); otherwise a pending change on a live published workshop.
    let kind: ChangeKind | null = null
    if (s.status === 'cancelled') {
      // Only registrants of a once-published event exist; the workshop's own status may
      // legitimately be 'cancelled' (cascade) or 'completed' by now — never 'draft'
      // (an unpublished-back-to-draft workshop deliberately stops all comms).
      if (workshop.status === 'published' || workshop.status === 'cancelled' || workshop.status === 'completed') {
        kind = 'event_cancelled'
      }
    } else if (s.change_kind === 'change_reschedule' || s.change_kind === 'change_venue') {
      if (workshop.status === 'published' && s.status === 'scheduled') kind = s.change_kind
    }
    if (!kind) continue

    const { data: regs, error: regsErr } = await db
      .from('workshop_registrations')
      .select(REG_COLS)
      .eq('session_id', s.id)
      .not('status', 'in', '("cancelled","ffs_referred")')
      .order('registered_at', { ascending: true })
      .limit(REGS_PER_SESSION)
    if (regsErr) {
      await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: s.id, diff: { query: 'change_registrations', error: regsErr.message } })
      errors.push(`change_registrations(${s.id}): ${regsErr.message}`)
      continue
    }

    const changeRecordedMs = s.change_recorded_at ? Date.parse(s.change_recorded_at) : null
    for (const reg of (regs ?? []) as RegRow[]) {
      // A change notice goes only to registrants the change actually CHANGED something
      // for: those who signed up before it was recorded. (Cancellations go to everyone
      // active — a post-cancel signup cannot exist; the claim RPC refuses them.)
      if (kind !== 'event_cancelled' && changeRecordedMs !== null) {
        const registeredMs = reg.registered_at ? Date.parse(reg.registered_at) : 0
        if (registeredMs > changeRecordedMs) continue
      }
      for (const channel of channelsForChange(reg)) {
        handled++
        try {
          const status = await sendWorkshopMessage(db, { reg, workshop, session: s, kind, channel, config })
          if (status === 'sent') sends++
          else if (status === 'deferred') deferred++
          else if (status === 'blocked') blocked++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`change(${reg.reg_id},${channel},${kind}): ${msg}`)
          await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, error: msg } })
          await releaseStrandedClaim(db, reg.reg_id, channel, kind, claimGeneration(kind, s.cadence_generation))
          deferred++
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, handled, sends, deferred, blocked }
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
    .select('id, workshop_id, starts_at, ends_at, timezone, delivery_mode, venue_name, venue_address, status, cadence_generation, workshop:workshops!inner(workshop_id, title, slug, is_security, status)')
    .gte('starts_at', lookbackStart)
    .lte('starts_at', nurtureCutoff)
    .neq('status', 'cancelled')
    .order('starts_at', { ascending: true })
    .limit(SESSIONS_PER_TICK)
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
    // WS-008b: nurture runs for events that HAPPENED — published (still live) or
    // completed workshops. Draft/pending/approved never legitimately held public
    // registrants, and a CANCELLED workshop's event never occurred (its registrants
    // get event_cancelled from the change pass, not post-event marketing).
    if (!workshop || (workshop.status !== 'published' && workshop.status !== 'completed')) continue
    // Anchor the nurture trigger to session end (fallback start); require it elapsed.
    const anchorMs = s.ends_at ? Date.parse(s.ends_at) : Date.parse(s.starts_at)
    if (!isNurtureDue({ anchorMs, nowMs, delayMinutes: config.nurture_delay_minutes })) continue

    const { data: regs, error: regsErr } = await db
      .from('workshop_registrations')
      .select(REG_COLS)
      .eq('session_id', s.id)
      .is('nurtured_at', null)
      .not('status', 'in', '("cancelled","ffs_referred")')
      .order('registered_at', { ascending: true })
      .limit(REGS_PER_SESSION)
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
        // WS-028: the nurtured_at CLAIM comes FIRST (guarded update — only one
        // concurrent pass wins the null→set transition), so the FFS routing side
        // effects can never double-run.
        if (workshop.is_security === true) {
          const { data: won } = await db
            .from('workshop_registrations')
            .update({ nurture_segment: 'ffs', nurtured_at: new Date().toISOString() })
            .eq('reg_id', reg.reg_id)
            .is('nurtured_at', null)
            .select('reg_id')
            .maybeSingle()
          if (!won) continue // another pass owns this registrant
          await routeSecuritiesToFfs(db, reg, workshop)
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

        // WS-028: CLAIM the segment routing BEFORE any side effect — a guarded update
        // that only one concurrent pass can win (nurtured_at null → set). The per-send
        // claims below still make each MESSAGE once-only; this claim makes the spine
        // seeding (referral/opportunity/score) once-only too.
        const { data: won } = await db
          .from('workshop_registrations')
          .update({ nurture_segment: segment, nurtured_at: new Date().toISOString() })
          .eq('reg_id', reg.reg_id)
          .is('nurtured_at', null)
          .select('reg_id')
          .maybeSingle()
        if (!won) continue // lost the race to a concurrent pass — it owns the side effects

        // WS-039: derive the DURABLE no-show attendance row for an ended session with
        // no capture at all — reporting truth without staff reconcile. Written AFTER
        // the claim (deterministic: the segment above was computed from the original
        // state, so the shipped registered_no_show recapture behavior is unchanged).
        if (!att) {
          await db.from('workshop_attendance').upsert(
            { registration_id: reg.reg_id, session_id: s.id, status: 'no_show', capture_method: 'derived', checked_in_at: null },
            { onConflict: 'registration_id,session_id' },
          )
        }

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

        // 3) Record the score delta (the claim above already stamped segment + time).
        await db
          .from('workshop_registrations')
          .update({ lead_score_delta: delta })
          .eq('reg_id', reg.reg_id)
        await writeAudit({ actor: ACTOR, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: { nurture_segment: segment, lead_score_delta: delta } })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`nurture(${reg.reg_id}): ${msg}`)
        await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { pass: 'nurture', error: msg } })
      }
    }

    // ── T+2/3d follow-up (D-1 pairing): ONE more claimed touch for registrants who
    //    already received the same-day nurture (nurtured_at set). MARKETING tier like
    //    every nurture send — the row's marketing_opt_in gates it inside
    //    sendWorkshopMessage; the generation-0 claim is the once-ever idempotency
    //    (no extra bookkeeping column). Securities-routed rows carry segment 'ffs'
    //    and are skipped with the status filter below.
    if (isFollowupDue({ anchorMs, nowMs, followupDelayMinutes: config.nurture_followup_delay_minutes })) {
      const { data: fups, error: fupErr } = await db
        .from('workshop_registrations')
        .select(`${REG_COLS}, nurture_segment`)
        .eq('session_id', s.id)
        .not('nurtured_at', 'is', null)
        .not('status', 'in', '("cancelled","ffs_referred")')
        .order('registered_at', { ascending: true })
        .limit(REGS_PER_SESSION)
      if (fupErr) {
        await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_session', entityId: s.id, diff: { query: 'followup_registrations', error: fupErr.message } })
        errors.push(`followup_registrations(${s.id}): ${fupErr.message}`)
      } else {
        for (const reg of (fups ?? []) as (RegRow & { nurture_segment: string | null })[]) {
          const seg = reg.nurture_segment
          if (seg !== 'attended' && seg !== 'left_early' && seg !== 'no_show' && seg !== 'registered_no_show') continue
          for (const channel of channelsForNurture(seg as Segment, reg)) {
            handled++
            try {
              const status = await sendWorkshopMessage(db, { reg, workshop, session: s, kind: 'nurture_followup', channel, config })
              if (status === 'sent') sends++
              else if (status === 'deferred') deferred++
              else if (status === 'blocked') blocked++
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              errors.push(`followup(${reg.reg_id},${channel}): ${msg}`)
              await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind: 'nurture_followup', channel, error: msg } })
              await releaseStrandedClaim(db, reg.reg_id, channel, 'nurture_followup', claimGeneration('nurture_followup', s.cadence_generation))
              deferred++
            }
          }
        }
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
 *   • qualified (attended/left_early): resolve the internal referral (REUSING an existing
 *     referral for the same email across registrations — WS-072 — before creating one),
 *     place a NATIVE pipeline opportunity at its entry stage (D-2(b): created at
 *     ATTENDANCE, native opportunities.stage taxonomy — 'prospect' is the entry stage the
 *     owner's "Contacted" maps onto; the CHECK in mig 009 has no other entry value), then
 *     mark the native lead conversion via convertRegistrationToLead.
 *   • recapture (no_show/registered): the segment tag + lead-score delta are recorded on the
 *     registration by the nurture caller; there is no external push, so this is a native no-op.
 * The lead-score delta is stored on the registration (auditable). No external pipeline push.
 * Attribution: workshop signups are DIRECT engagements (no referring agency), so the
 * referral/opportunity carry engagement='direct' with no referring_agency_id — the WS-072
 * attribution half is N/A by design for this source. owner_scope is a uuid column; the
 * engine is not a user, so it stays null and attribution lives in the audit trail.
 */
async function routeSegmentToSpine(db: Db, reg: RegRow, workshop: WorkshopRow, segment: Segment, _delta: number): Promise<void> {
  const tag = segmentTag(segment)

  if (segmentIsQualified(segment)) {
    // ── Resolve the referral spine row: linked → reuse; same-email exists → adopt
    //    (WS-072 dedupe: one person, many workshops, ONE referral); else create. ──
    let referralId: string | null = reg.referral_id
    if (!referralId && reg.email) {
      const { data: existingRef, error: lookupErr } = await db
        .from('referrals')
        .select('id')
        .ilike('referred_email', reg.email)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (lookupErr) {
        // WS-064 discipline: an unreadable dedupe lookup must not mint a duplicate —
        // skip the spine this tick (audited); the next nurture tick retries.
        await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { query: 'referral_dedupe', error: lookupErr.message } })
        return
      }
      if (existingRef?.id) {
        referralId = existingRef.id
        await db.from('workshop_registrations').update({ referral_id: referralId }).eq('reg_id', reg.reg_id)
        await writeAudit({ actor: ACTOR, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: { referral_id: referralId, dedupe: 'existing_referral_same_email', segment } })
      }
    }
    if (!referralId) {
      const now = new Date()
      const { data: ref, error: refErr } = await db
        .from('referrals')
        .insert({
          referred_name: reg.name ?? 'Workshop attendee',
          referred_email: reg.email ?? null,
          referred_phone: reg.phone ?? null,
          engagement: 'direct',
          status: 'received',
          received_at: now.toISOString(),
          sla_due_at: new Date(now.getTime() + 24 * 3600000).toISOString(),
          owner_scope: null,
        })
        .select('id')
        .maybeSingle()
      if (refErr || !ref?.id) {
        // Surfaced, not swallowed (the old code discarded this error — and its
        // owner_scope string could never satisfy the uuid column, failing every row).
        await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { query: 'referral_insert', error: refErr?.message ?? 'no row returned' } })
        return
      }
      referralId = ref.id
      await db.from('workshop_registrations').update({ referral_id: referralId }).eq('reg_id', reg.reg_id)
      await writeAudit({ actor: ACTOR, action: 'entity.created', entity: 'referral', entityId: referralId, diff: { source: 'workshop_nurture', segment, registration_id: reg.reg_id } })
    }

    // ── D-2(b): the pipeline opportunity, placed AT ATTENDANCE, native entry stage.
    //    Deduped on the referral (covers the manual convert route having already
    //    originated one, and this pass re-ticking). ──
    const { data: existingOpp, error: oppLookupErr } = await db
      .from('opportunities')
      .select('id')
      .eq('referral_id', referralId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (oppLookupErr) {
      await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { query: 'opportunity_dedupe', error: oppLookupErr.message } })
      return
    }
    if (!existingOpp) {
      const stage = 'prospect' // native entry stage (mig 009 CHECK) — D-2's "Contacted" placement
      const { data: opp, error: oppErr } = await db
        .from('opportunities')
        .insert({
          referral_id: referralId,
          engagement: 'direct',
          stage,
          is_security: workshop.is_security === true,
          // D-2 (checkpoint ruling): the queryable origin marker — district reporting
          // segments workshop-attendance placements from conversion/cross-sell
          // opportunities sitting in the same native stage.
          source: 'workshop_attendance',
          stage_history: [{ stage, at: new Date().toISOString(), actor: ACTOR, source: 'workshop_attendance', segment }],
          owner_scope: null,
        })
        .select('id')
        .maybeSingle()
      if (oppErr?.code === '23505') {
        // The convert route won the race: it inserted this referral's opportunity between
        // our lookup and this insert. idx_opportunities_live_referral (migration 134)
        // decides it, and a unique violation here is SUCCESS — the placement already
        // exists, which is exactly the outcome this block wanted. Nothing to enrich from
        // the engine's side (the convert route carries the richer attribution), so record
        // the no-op and fall through rather than logging a comms.error for a healthy state.
        await writeAudit({ actor: ACTOR, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: { from_referral: referralId, opportunity_already_placed: true, lost_insert_race: true, segment } })
        return
      }
      if (oppErr || !opp?.id) {
        await writeAudit({ actor: ACTOR, action: 'comms.error', entity: 'workshop_registration', entityId: reg.reg_id, diff: { query: 'opportunity_insert', error: oppErr?.message ?? 'no row returned' } })
        return
      }
      await writeAudit({ actor: ACTOR, action: 'entity.created', entity: 'opportunity', entityId: opp.id, diff: { from_referral: referralId, source: 'workshop_attendance', segment, stage } })
      await writeAudit({ actor: ACTOR, action: 'stage.changed', entity: 'opportunity', entityId: opp.id, diff: { from: null, to: stage } })
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

// ── Registrant-cancel acknowledgment (WS-009) ───────────────────────────────────

/**
 * Send the cancel_ack for a just-cancelled registration through the SAME claimed path
 * as every engine send (claim → template gate → dispatcher gate). Email only — it is a
 * receipt, not an alert. One-time kind: claims at generation 0, so it can never repeat,
 * reschedule or not. Honors the kill switch; while the cancel_ack template is an
 * unapproved placeholder the claim records a deferral and nothing sends (D-5).
 * The CANCELLATION ITSELF is effective regardless of this acknowledgment's fate.
 */
export async function sendCancelAcknowledgment(db: Db, regId: string): Promise<LogStatus | 'skipped'> {
  const config = await loadConfig(db)
  if (killSwitchOff() || !config.enabled) return 'skipped'

  const { data: reg } = await db.from('workshop_registrations').select(REG_COLS).eq('reg_id', regId).maybeSingle()
  const regRow = (reg ?? null) as RegRow | null
  if (!regRow?.email) return 'skipped'

  const { data: w } = await db
    .from('workshops')
    .select('workshop_id, title, slug, is_security, status')
    .eq('workshop_id', regRow.workshop_id)
    .maybeSingle()
  const workshop = (w ?? null) as WorkshopRow | null
  // Standing firewall: securities workshops get nothing automated.
  if (!workshop || workshop.is_security === true) return 'skipped'

  let session: SessionRow | null = null
  if (regRow.session_id) {
    const { data: s } = await db
      .from('workshop_sessions')
      .select('id, workshop_id, starts_at, ends_at, timezone, delivery_mode, venue_name, venue_address, status, cadence_generation')
      .eq('id', regRow.session_id)
      .maybeSingle()
    session = (s ?? null) as SessionRow | null
  }

  return sendWorkshopMessage(db, { reg: regRow, workshop, session, kind: 'cancel_ack', channel: 'email', config })
}
