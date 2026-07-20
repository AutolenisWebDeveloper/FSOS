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
//    as durableConsentGranted. DNC/STOP (gate step 3) is the independent opt-out backstop.
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
import {
  convertRegistrationToLead,
  type WorkshopLeadContext,
} from './server'
import {
  upsertContactWithRetry,
  addContactTags,
  GHL_CUSTOM_FIELDS,
  ghlEnabled,
} from '@/lib/ghl'
import {
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
    return CONFIG_DEFAULTS
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
  created_at: string | null
  status: string | null
  workshop_id: string
  session_id: string | null
  ghl_opportunity_id: string | null
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
    // Leave the dispatcher-personalize name tokens for send.ts; substitute the rest.
    if (key === 'first_name' || key === 'full_name' || key === 'last_name') return m
    return key in tokens ? tokens[key] : ''
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

// ── Durable per-channel consent guard ───────────────────────────────────────────

/**
 * True only when the LATEST workshop_consent_events action for this registration+channel is
 * `granted`. A later `revoked` wins. No row → false. This is the durable per-channel consent
 * guard P2 relies on; it is also passed to the gate as durableConsentGranted.
 */
export async function durableConsentGranted(db: Db, regId: string, channel: Channel): Promise<boolean> {
  const { data } = await db
    .from('workshop_consent_events')
    .select('action, captured_at')
    .eq('registration_id', regId)
    .eq('channel', channel)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.action === 'granted'
}

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

  // Existing log → claim decision.
  const { data: existing } = await db
    .from('workshop_message_log')
    .select('id, status, attempts')
    .eq('registration_id', reg.reg_id)
    .eq('channel', channel)
    .eq('kind', kind)
    .maybeSingle()
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

  // Durable per-channel consent guard (belt + suspenders with the gate).
  const consent = await durableConsentGranted(db, reg.reg_id, channel)
  if (!consent) {
    await writeAudit({ actor: ACTOR, action: 'comms.blocked', entity: 'workshop_registration', entityId: reg.reg_id, diff: { kind, channel, reason: 'no_channel_consent' } })
    return finalize('blocked', { gate_blocked_step: 'consent', reason: 'no_channel_consent' })
  }

  // Quiet-hours scheduling pre-check (recipient-local). Outside → defer (retry next tick),
  // do NOT dispatch (avoids a compliance-event escalation for a purely time-based hold).
  const nowMs = Date.now()
  const utcOffset = utcOffsetHoursForTimezone(session?.timezone, nowMs)
  const localHour = recipientLocalHour(nowMs, utcOffset)
  if (!withinQuietHours(localHour)) {
    return finalize('deferred', { gate_blocked_step: 'quiet_hours', reason: 'outside_quiet_hours' })
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
    utcOffsetHours: utcOffset,
    entity: { type: 'workshop_registration', id: reg.reg_id },
    recipientContext: { full_name: reg.name },
  })

  const status = classifySendOutcome(outcome.sent, outcome.gate.blockedStep)
  return finalize(status, { gate_blocked_step: outcome.gate.blockedStep ?? null, reason: outcome.reason ?? null, comm_message_id: outcome.messageId ?? null })
}

// ── PASS 1: pre-event reminders ─────────────────────────────────────────────────

export interface PassResult {
  ok: boolean
  note?: string
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
  const { data: sessions } = await db
    .from('workshop_sessions')
    .select('id, workshop_id, starts_at, ends_at, timezone, venue_name, venue_address, status, workshop:workshops!inner(workshop_id, title, slug, is_security, status)')
    .gte('starts_at', windowStart)
    .lte('starts_at', windowEnd)
    .neq('status', 'cancelled')
  const rows = (sessions ?? []) as unknown as (SessionRow & { workshop: WorkshopRow })[]

  let handled = 0
  let sends = 0
  let deferred = 0
  let blocked = 0

  for (const s of rows) {
    const workshop = s.workshop
    if (!workshop || workshop.status !== 'published' || workshop.is_security === true) continue

    const { data: regs } = await db
      .from('workshop_registrations')
      .select('reg_id, name, email, phone, consent_channels, join_url, created_at, status, workshop_id, session_id, ghl_opportunity_id, referral_id')
      .eq('session_id', s.id)
      .not('status', 'in', '("cancelled","ffs_referred")')
    const regList = (regs ?? []) as RegRow[]

    for (const reg of regList) {
      const startMs = Date.parse(s.starts_at)
      const registeredMs = reg.created_at ? Date.parse(reg.created_at) : 0
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
          const status = await sendWorkshopMessage(db, { reg, workshop, session: s, kind, channel, config })
          if (status === 'sent') sends++
          else if (status === 'deferred') deferred++
          else if (status === 'blocked') blocked++
        }
      }
    }
  }

  return { ok: true, handled, sends, deferred, blocked }
}

/**
 * Channels to attempt for a reminder kind, intersected with the registrant's consented
 * channels (consent_channels staging array; durable consent re-checked at send). Cadence
 * (spec §2.3): confirmation/7d = email; 1d/1h = email + SMS; starting = SMS.
 */
function channelsForReminder(kind: ReminderKind, reg: RegRow): Channel[] {
  const consented = new Set((reg.consent_channels ?? []).map((c) => c))
  const wants: Channel[] =
    kind === 'reminder_starting'
      ? ['sms']
      : kind === 'reminder_1d' || kind === 'reminder_1h'
        ? ['email', 'sms']
        : ['email']
  return wants.filter((c) => consented.has(c) && (c === 'email' ? !!reg.email : !!reg.phone))
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

  // Recently-ended sessions whose nurture-delay has elapsed.
  const { data: sessions } = await db
    .from('workshop_sessions')
    .select('id, workshop_id, starts_at, ends_at, timezone, venue_name, venue_address, status, workshop:workshops!inner(workshop_id, title, slug, is_security, status)')
    .gte('starts_at', lookbackStart)
    .lte('starts_at', nurtureCutoff)
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

    const { data: regs } = await db
      .from('workshop_registrations')
      .select('reg_id, name, email, phone, consent_channels, join_url, created_at, status, workshop_id, session_id, ghl_opportunity_id, referral_id')
      .eq('session_id', s.id)
      .is('nurtured_at', null)
      .not('status', 'in', '("cancelled","ffs_referred")')
    const regList = (regs ?? []) as RegRow[]

    for (const reg of regList) {
      handled++
      // ── is_security firewall: never enter automated segments; route to FFS. ──
      if (workshop.is_security === true) {
        await routeSecuritiesToFfs(db, reg, workshop)
        await db.from('workshop_registrations').update({ nurture_segment: 'ffs', nurtured_at: new Date().toISOString() }).eq('reg_id', reg.reg_id)
        continue
      }

      // Segment from attendance status.
      const { data: att } = await db
        .from('workshop_attendance')
        .select('status')
        .eq('registration_id', reg.reg_id)
        .eq('session_id', s.id)
        .maybeSingle()
      const segment = segmentFor((att?.status as 'registered' | 'attended' | 'no_show' | 'left_early' | undefined) ?? null)
      const kind = nurtureKindForSegment(segment)

      // 1) Segment nurture message (gated per consented channel).
      for (const channel of channelsForNurture(segment, reg)) {
        const status = await sendWorkshopMessage(db, { reg, workshop, session: s, kind, channel, config })
        if (status === 'sent') sends++
        else if (status === 'deferred') deferred++
        else if (status === 'blocked') blocked++
      }

      // 2) Route into the consult spine (GHL) + lead-score delta.
      const delta = scoreDeltaForSegment(segment, config.scores)
      await routeSegmentToSpine(db, reg, workshop, segment, delta)

      // 3) Mark nurtured (idempotency at the segment level).
      await db
        .from('workshop_registrations')
        .update({ nurture_segment: segment, nurtured_at: new Date().toISOString(), lead_score_delta: delta })
        .eq('reg_id', reg.reg_id)
      await writeAudit({ actor: ACTOR, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: { nurture_segment: segment, lead_score_delta: delta } })
    }
  }

  return { ok: true, handled, sends, deferred, blocked }
}

/** SMS/email channels to attempt for a nurture segment, intersected with consent. */
function channelsForNurture(segment: Segment, reg: RegRow): Channel[] {
  const consented = new Set((reg.consent_channels ?? []).map((c) => c))
  // Email for all segments; SMS additionally for attended + no_show (the higher-intent
  // touches). All still consent-gated + placeholder-gated + quiet-hours-gated.
  const wants: Channel[] = segment === 'no_show' || segment === 'attended' ? ['email', 'sms'] : ['email']
  return wants.filter((c) => consented.has(c) && (c === 'email' ? !!reg.email : !!reg.phone))
}

/** Securities workshop → FFS-supervised path (firewall). No message, no automated segment. */
async function routeSecuritiesToFfs(db: Db, reg: RegRow, workshop: WorkshopRow): Promise<void> {
  const ctx: WorkshopLeadContext = { is_security: true, slug: workshop.slug, title: workshop.title }
  await convertRegistrationToLead(
    db,
    { reg_id: reg.reg_id, name: reg.name, email: reg.email, phone: reg.phone, ghl_opportunity_id: reg.ghl_opportunity_id },
    ctx,
    ACTOR,
  )
  await writeAudit({ actor: ACTOR, action: 'firewall.blocked', entity: 'workshop_registration', entityId: reg.reg_id, diff: { nurture: 'securities_ffs' } })
}

// Segments that seed the internal referral + a Pipeline-A opportunity (the qualified
// consult candidates). No-show / registered-never-attended get the tag + score only (the
// GHL recapture workflow + replay re-entry create the opportunity when they re-engage).
function segmentIsQualified(segment: Segment): boolean {
  return segment === 'attended' || segment === 'left_early'
}

/**
 * Route a nurture segment into the existing consult spine:
 *   • qualified (attended/left_early): reuse convertRegistrationToLead → GHL contact
 *     (lead_source="Event") + src-event/wshop-<slug>/<segment> tags + Pipeline-A
 *     opportunity; PLUS seed the internal referral (same shape as the P1 convert route).
 *   • recapture (no_show/registered): GHL contact upsert with the segment tag + lead_source
 *     only (no opportunity) so the manual GHL recapture workflow picks it up.
 * The lead-score delta is stored on the registration (auditable) and applied to GHL
 * lead_score by the segment-tag GHL workflow (see docs/ghl_workshop_workflows.md) — FSOS
 * supplies the config-default delta + the trigger tag; it does not clobber the absolute
 * GHL score. GHL-off → no-op cleanly.
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
    // GHL push (contact + tags + Pipeline-A opportunity), reusing the canonical convert.
    const outcome = await convertRegistrationToLead(
      db,
      { reg_id: reg.reg_id, name: reg.name, email: reg.email, phone: reg.phone, ghl_opportunity_id: reg.ghl_opportunity_id },
      { is_security: workshop.is_security === true, slug: workshop.slug, title: workshop.title },
      ACTOR,
      [tag],
    )
    if (outcome.ok && outcome.routed === 'ghl' && !outcome.skipped) {
      const patch: Record<string, unknown> = { lead_converted_at: new Date().toISOString() }
      if (outcome.ghl_contact_id) patch.ghl_contact_id = outcome.ghl_contact_id
      if (outcome.ghl_opportunity_id) patch.ghl_opportunity_id = outcome.ghl_opportunity_id
      await db.from('workshop_registrations').update(patch).eq('reg_id', reg.reg_id)
      await writeAudit({ actor: ACTOR, action: 'entity.created', entity: 'ghl_opportunity', entityId: outcome.ghl_opportunity_id ?? reg.reg_id, diff: { source: 'workshop_nurture', segment, lead_source: 'Event' } })
    }
    return
  }

  // Recapture segments: tag + lead_source only, no opportunity. No-op cleanly if GHL off.
  if (!ghlEnabled()) return
  const [firstName, ...rest] = (reg.name ?? 'Workshop attendee').trim().split(/\s+/)
  const tags = ['src-event', `wshop-${(workshop.slug ?? 'workshop').slice(0, 60)}`, tag]
  const contactRes = await upsertContactWithRetry({
    firstName,
    lastName: rest.join(' ') || undefined,
    email: reg.email,
    phone: reg.phone,
    tags,
    source: 'Event',
    customFields: { [GHL_CUSTOM_FIELDS.lead_source]: 'Event' },
  })
  const contactId = contactRes.data?.contact?.id ?? null
  if (contactId) {
    await addContactTags(contactId, tags)
    await db.from('workshop_registrations').update({ ghl_contact_id: contactId }).eq('reg_id', reg.reg_id)
    await writeAudit({ actor: ACTOR, action: 'entity.updated', entity: 'workshop_registration', entityId: reg.reg_id, diff: { source: 'workshop_nurture', segment, tags } })
  }
}
