// src/lib/comms/dispatch-policy.ts
// THE DISPATCH-TIME POLICY RESOLVER — everything the chokepoint (messaging.ts sendSms /
// sendEmail) needs in order to decide, resolved FRESH at the moment of dispatch.
//
// WHY IT LIVES HERE AND NOT IN THE CALLER. Before this, policy was computed by
// `sendThroughGate`, which 18 call sites used and nine other send paths did not. A check
// that only runs when the caller opts in is not a control — it is a convention. Moving the
// resolution behind the provider boundary makes it structurally unskippable: the only way
// to reach Twilio or Resend is through sendSms/sendEmail, and the only way through those is
// through this module.
//
// THE TWO CALLER SHAPES. This is the design point that makes consolidation possible:
//
//   • ENRICHED callers (the campaign engines, the AI workforce, the console) already know
//     the member, household, purpose, template and conversation. They pass them in, and
//     resolution is a verification of what they claim.
//   • BARE callers (the transactional acks, the password-setup mail, the booking fallback)
//     know only an address and a body. For them this module resolves the recipient from
//     the ADDRESS ALONE — `resolveContact` gives member/household/agency, and consent, DNC
//     and suppression follow from there.
//
// Both shapes run the SAME code and the SAME pure gate. There is no "transactional
// shortcut" branch, because a second branch is a second path, and a second path is what
// Phase A found nine of.
//
// FAIL CLOSED, EVERYWHERE. Every lookup here returns the RESTRICTIVE answer on error:
// DNC unknown → treated as on-DNC; suppression unknown → suppressed; consent unknown →
// absent; timezone unknown → unresolved (which is itself a hard block). A dispatch-time
// resolver that fails open converts a database blip into an unwanted message.
//
// Heavy modules are imported LAZILY through the `deps` seam so this file stays loadable
// under the runtime-tsc test harness without eagerly pulling Supabase.

import { evaluateGate, type GateInput, type GateResult } from './gate'
import { quietHoursApply, type MessagePurpose } from './purpose'
import { evaluateQuietHours, type HoursWindow, type QuietHoursDecision } from './quiet-hours-window'
import { resolveRecipientTimeZone, type TimezoneResolution } from './recipient-timezone'
import { DEFAULT_TIMEZONE } from './local-time'
import { isBusinessSuppressible } from './suppression'

export type Channel = 'sms' | 'email'

/**
 * How gate step 4 (approved content) is satisfied. Making this EXPLICIT per call site is
 * what let the nine bare paths join the gated path without a bypass: a code-authored
 * transactional notice is a real, reviewed, version-controlled template, and saying so is
 * an auditable declaration recorded on the message — not an exemption flag.
 */
export type TemplateKind =
  /** An approved row in `comm_templates` (the caller passes `templateId`). */
  | 'stored'
  /** A licensed operator personally typed this 1:1 message. */
  | 'human'
  /** AI-authored under an approved AI policy (the agent's kill switch is the approval). */
  | 'ai_policy'
  /**
   * A fixed, code-resident transactional notice: the booking confirmation, the visitor
   * acknowledgement, the password-setup mail. These carry no marketing content, are not
   * model-generated, and change only through code review. Declaring this satisfies step 4;
   * it relaxes NOTHING else — consent, DNC, suppression, the red line and the firewall all
   * still run.
   */
  | 'system_transactional'

export interface DispatchPolicyContext {
  channel: Channel
  /** Normalized recipient (phone or email). */
  to: string
  /** The AUTHORED body, BEFORE any SMS opt-out footer is appended. */
  body: string
  actor: string
  entity?: { type: string; id: string }

  // ── Enrichment. All optional; absent means "resolve it from `to`". ──
  memberId?: string | null
  householdId?: string | null
  agencyId?: string | null
  conversationId?: string | null
  purpose?: MessagePurpose
  templateId?: string | null
  templateKind?: TemplateKind
  aiAuthorAgentKey?: string
  /** True for AI-authored content — triggers the §11/§12 authority evaluation below. */
  aiGenerated?: boolean
  /** The §11 AI message class. An absent/unknown class fails SAFE to draft_only. */
  aiMessageClass?: string
  /** §12 input: the first-contact identity disclosure requirement was satisfied. */
  identityDisclosureSatisfied?: boolean
  /** Caller-verified durable consent for a domain owning its own evidence store. */
  durableConsentGranted?: boolean
  /** Console / verified-self-test consent waiver (ADR-033). Opt-out-safe. */
  consentWaived?: boolean
  isSecurity?: boolean
  /** Explicit non-suppressible declaration for correctly-classified transactional sends. */
  suppressible?: boolean
  isTest?: boolean
  isConversationReply?: boolean
  activeCampaignPurpose?: MessagePurpose | null
  ownershipResolved?: boolean
  ownershipConflict?: string
  delegationValid?: boolean
  delegationReason?: string
  personalizationResolved?: boolean
  personalizationReason?: string
  dataConfidenceOk?: boolean
  dataConfidenceReason?: string

  // ── Configured-window scoping (step 4 of the brief). ──
  /** `ai_agents.key` for the worker whose window applies, when a worker drives this send. */
  workerKey?: string | null
  /** Campaign identifier whose window applies, when a campaign drives this send. */
  campaignKey?: string | null

  // ── Timezone resolution inputs. ──
  /** Recipient phone for NPA resolution. Defaults to `to` on the SMS channel. */
  recipientPhone?: string | null
  /** Recipient ZIP for the secondary resolution. */
  recipientZip?: string | null
  /** Caller-resolved offset (the workshop engine). Wins over map resolution when present. */
  utcOffsetHours?: number
  /** Caller-resolved IANA zone. Wins over map resolution when present. */
  timeZone?: string
}

export interface DispatchPolicyDecision {
  gate: GateResult
  allowed: boolean
  /** What the timezone resolution produced — recorded on the send record (step 5). */
  timezone: {
    resolution: TimezoneResolution
    /** The zone actually used for the hour computation. */
    zone: string | null
    localHour: number | null
    localDay: number | null
    /** True when the legacy fixed-zone path produced this (flag OFF). */
    legacy: boolean
  }
  quietHours?: QuietHoursDecision
  /** The §11/§12 verdict when this was an AI send, so the caller can record the draft. */
  aiAuthority?: { authority: string; mayAutoSend: boolean; failures: string[] }
  /** Resolved linkage, so the caller can persist it without re-reading. */
  resolved: {
    memberId: string | null
    householdId: string | null
    agencyId: string | null
    consent: boolean
    onDNC: boolean
    suppressed: boolean | undefined
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * QUIET_HOURS_RECIPIENT_LOCAL — the migration switch for recipient-local quiet hours.
 *
 * OFF (default) reproduces today's behavior EXACTLY: the local hour is computed in
 * `America/Chicago`, the practice's own zone, and the timezone step can never block. ON
 * resolves the recipient's real zone from their NPA or ZIP and fails closed when it cannot.
 *
 * This flag selects RESOLVER BEHAVIOR inside one code path. It does not branch the dispatch
 * path: the same function runs, the same gate is evaluated, the same audit is written. Two
 * dispatch paths would be a second send path, which is the thing this whole change removes.
 */
export function recipientLocalQuietHoursEnabled(): boolean {
  const v = (process.env.QUIET_HOURS_RECIPIENT_LOCAL || '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

// ─────────────────────────────────────────────────────────────────────────────
// Injectable readers (all DB access goes through here)
// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyDeps {
  resolveContactLink(channel: Channel, to: string): Promise<{ memberId: string | null; householdId: string | null; agencyId: string | null }>
  memberConsent(memberId: string | null, channel: Channel): Promise<boolean>
  contactConsent(to: string, channel: Channel): Promise<boolean>
  consentRevoked(memberId: string | null, to: string, channel: Channel, purpose?: MessagePurpose): Promise<boolean>
  onDNC(to: string, channel: Channel): Promise<boolean>
  templateApproved(templateId: string | null | undefined): Promise<boolean>
  aiPolicyApproved(agentKey?: string): Promise<boolean>
  suppression(subject: {
    memberId: string | null; householdId: string | null; agencyId: string | null
    contactId: string | null; phone: string | null; email: string | null
  }): Promise<{ suppressed: boolean; resolved: boolean; reason?: string }>
  withinBusinessHours(): Promise<boolean>
  /** Recipient contact record fields used for timezone resolution (phone + ZIP). */
  recipientLocation(memberId: string | null, householdId: string | null, to: string, channel: Channel): Promise<{ phone: string | null; zip: string | null }>
  /** The configured send window for a scope key, or null when none/disabled. */
  hoursWindow(scopeKey: string): Promise<HoursWindow | null>
  sendPolicy(input: {
    memberId: string | null; channel: Channel; purpose: MessagePurpose
    conversationId: string | null; activeCampaignPurpose: MessagePurpose | null
    frequencyPolicyId: 'global' | 'reply'
  }): Promise<{ consentForPurpose: boolean | null; frequency: { allowed: boolean; reason?: string }; collision: { allowed: boolean; reason?: string } }>
  smsLive(channel: Channel): boolean
  conversationIsSecurity(conversationId: string | null, householdId: string | null): Promise<boolean>
}

export const defaultPolicyDeps: PolicyDeps = {
  async resolveContactLink(channel, to) {
    try {
      const { resolveContact } = await import('./conversations')
      const link = await resolveContact(channel, to)
      return {
        memberId: link.memberId ?? null,
        householdId: link.householdId ?? null,
        agencyId: link.agencyId ?? null,
      }
    } catch {
      return { memberId: null, householdId: null, agencyId: null }
    }
  },
  async memberConsent(memberId, channel) {
    if (!memberId) return false
    try {
      const { getDb } = await import('../supabase/client')
      const { data } = await getDb().from('consents').select('status').eq('member_id', memberId).eq('channel', channel).maybeSingle()
      return data?.status === 'granted'
    } catch {
      return false // fail closed
    }
  },
  async contactConsent(to, channel) {
    try {
      const { durableContactConsentGranted } = await import('./contact-consent-read')
      return await durableContactConsentGranted(to, channel)
    } catch {
      return false // fail closed
    }
  },
  async consentRevoked(memberId, to, channel, purpose) {
    try {
      const { contactConsentRevoked } = await import('./contact-consent-read')
      return await contactConsentRevoked(memberId, to, channel, purpose)
    } catch {
      return true // fail safe: an unverifiable revoke disables the waiver
    }
  },
  async onDNC(to, channel) {
    try {
      const { isOnDNC } = await import('./contact-consent-read')
      return await isOnDNC(to, channel)
    } catch {
      return true // fail safe: never send blind
    }
  },
  async templateApproved(templateId) {
    if (!templateId) return false
    try {
      const { getDb } = await import('../supabase/client')
      const { data } = await getDb().from('comm_templates').select('approval_status, archived_at').eq('id', templateId).maybeSingle()
      return data?.approval_status === 'approved' && !data?.archived_at
    } catch {
      return false
    }
  },
  async aiPolicyApproved(agentKey = 'conversation') {
    if (process.env.AI_GATEWAY_DISABLED === '1') return false
    try {
      const { getDb } = await import('../supabase/client')
      const db = getDb()
      const [{ data: pol }, { data: agent }] = await Promise.all([
        db.from('ai_policies').select('gateway_enabled').eq('id', 'global').maybeSingle(),
        db.from('ai_agents').select('enabled').eq('key', agentKey).maybeSingle(),
      ])
      return pol?.gateway_enabled !== false && agent?.enabled === true
    } catch {
      return false
    }
  },
  async suppression(subject) {
    try {
      const { resolveEffectiveSuppression } = await import('./suppression')
      return await resolveEffectiveSuppression(subject)
    } catch {
      // FAIL CLOSED. `resolved: false` is itself a withhold at the gate — an undetermined
      // suppression state must never become "allowed".
      return { suppressed: true, resolved: false, reason: 'Suppression could not be resolved — fail closed.' }
    }
  },
  async withinBusinessHours() {
    try {
      const { isWithinOperatingHours } = await import('./hours')
      return await isWithinOperatingHours()
    } catch {
      return true // business hours is a soft deferral; a lookup failure must not hard-block
    }
  },
  async recipientLocation(memberId, householdId, to, channel) {
    try {
      const { getDb } = await import('../supabase/client')
      const db = getDb()
      // On SMS the destination IS the phone — the most direct resolution input there is.
      let phone: string | null = channel === 'sms' ? to : null
      let zip: string | null = null
      if (memberId) {
        const { data } = await db.from('household_members').select('phone').eq('id', memberId).maybeSingle()
        phone = phone ?? (data?.phone ?? null)
      }
      // `household_members` carries no address, so the ZIP comes from the household or,
      // for a contact-resolvable recipient, the contacts row.
      if (householdId) {
        const { data } = await db.from('households').select('zip').eq('id', householdId).maybeSingle()
        zip = data?.zip ?? null
      }
      if (!phone || !zip) {
        const col = channel === 'sms' ? 'phone_digits' : 'email_lc'
        const val = channel === 'sms' ? to.replace(/\D/g, '').slice(-10) : to.toLowerCase()
        const q = db.from('contacts').select('phone, zip').is('deleted_at', null).limit(1)
        const { data } = channel === 'sms'
          ? await q.ilike(col, `%${val}`)
          : await q.eq(col, val)
        const row = Array.isArray(data) ? data[0] : null
        phone = phone ?? (row?.phone ?? null)
        zip = zip ?? (row?.zip ?? null)
      }
      return { phone, zip }
    } catch {
      return { phone: channel === 'sms' ? to : null, zip: null }
    }
  },
  async hoursWindow(scopeKey) {
    try {
      const { loadScopedHoursWindow } = await import('./hours')
      return await loadScopedHoursWindow(scopeKey)
    } catch {
      return null
    }
  },
  async sendPolicy(input) {
    try {
      const { resolveSendPolicy } = await import('./policy-resolver')
      return await resolveSendPolicy(input)
    } catch {
      // FAIL CLOSED as a DEFERRAL, not a suppression: an unreadable frequency policy means
      // we cannot prove this send is within its caps, so it is held for a later cycle rather
      // than sent on an assumption. `consentForPurpose: null` leaves the channel-wide consent
      // read (performed separately, and itself fail-closed) as the authority.
      return {
        consentForPurpose: null,
        frequency: { allowed: false, reason: 'Frequency policy could not be read — held for a later cycle.' },
        collision: { allowed: true },
      }
    }
  },
  smsLive(channel) {
    // Static require is safe: a2p.ts reads only process.env.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { smsLiveFor } = require('./a2p') as typeof import('./a2p')
    return smsLiveFor(channel)
  },
  async conversationIsSecurity(conversationId, householdId) {
    try {
      const { getDb } = await import('../supabase/client')
      const db = getDb()
      if (conversationId) {
        const { data } = await db.from('comm_conversations').select('is_security').eq('id', conversationId).maybeSingle()
        if (data?.is_security === true) return true
      }
      if (householdId) {
        const { conversationIsSecurity } = await import('./conversations')
        return await conversationIsSecurity(householdId)
      }
      return false
    } catch {
      return false
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Timezone
// ─────────────────────────────────────────────────────────────────────────────

/** Local hour + day-of-week in an IANA zone. DST-correct via Intl. */
export function localPartsInZone(timeZone: string, at: Date = new Date()): { hour: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    weekday: 'short',
  }).formatToParts(at)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12')
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { hour: Number.isFinite(hour) ? hour : 12, day: days[wd] ?? 0 }
}

/**
 * Resolve the zone this send's quiet hours is evaluated in.
 *
 * ONE code path, two resolver behaviors selected by the flag:
 *   • flag OFF → `America/Chicago`, always resolvable. This is EXACTLY today's behavior
 *     (send.ts `recipientLocalHour` defaulted to DEFAULT_TIMEZONE for all but one caller).
 *   • flag ON  → the recipient's real zone from NPA (primary) or ZIP (secondary), and an
 *     explicit non-resolution when neither places them.
 *
 * A caller that already resolved a zone or offset itself (the workshop engine, which
 * derives one from the session) still wins in both modes — it is strictly better
 * information than the map.
 */
export function resolveDispatchTimeZone(
  ctx: Pick<DispatchPolicyContext, 'utcOffsetHours' | 'timeZone'>,
  location: { phone: string | null; zip: string | null },
  flagOn: boolean,
  at: Date = new Date(),
): DispatchPolicyDecision['timezone'] {
  // Caller-supplied IANA zone wins outright.
  if (ctx.timeZone) {
    const { hour, day } = localPartsInZone(ctx.timeZone, at)
    return {
      resolution: { resolved: true, timeZone: ctx.timeZone, method: 'npa', input: 'caller', approximate: false },
      zone: ctx.timeZone, localHour: hour, localDay: day, legacy: false,
    }
  }
  // Caller-supplied fixed offset (the workshop engine). Kept for compatibility; the offset
  // cannot name a zone, so it is reported as a caller resolution.
  if (typeof ctx.utcOffsetHours === 'number' && Number.isFinite(ctx.utcOffsetHours)) {
    const shifted = new Date(at.getTime() + ctx.utcOffsetHours * 3600000)
    return {
      resolution: { resolved: true, timeZone: `UTC${ctx.utcOffsetHours >= 0 ? '+' : ''}${ctx.utcOffsetHours}`, method: 'npa', input: 'caller_offset', approximate: true },
      zone: null, localHour: shifted.getUTCHours(), localDay: shifted.getUTCDay(), legacy: false,
    }
  }

  if (!flagOn) {
    // LEGACY: the practice's own zone, exactly as before this change.
    const { hour, day } = localPartsInZone(DEFAULT_TIMEZONE, at)
    return {
      resolution: { resolved: true, timeZone: DEFAULT_TIMEZONE, method: 'npa', input: 'legacy_default', approximate: true },
      zone: DEFAULT_TIMEZONE, localHour: hour, localDay: day, legacy: true,
    }
  }

  const resolution = resolveRecipientTimeZone({ phone: location.phone, zip: location.zip })
  if (!resolution.resolved) {
    return { resolution, zone: null, localHour: null, localDay: null, legacy: false }
  }
  const { hour, day } = localPartsInZone(resolution.timeZone, at)
  return { resolution, zone: resolution.timeZone, localHour: hour, localDay: day, legacy: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// The resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve every dispatch-time policy input and run the pure gate. This is the ONE place
 * the decision is made; `messaging.ts` calls it and obeys the answer.
 */
export async function resolveDispatchPolicy(
  ctx: DispatchPolicyContext,
  deps: PolicyDeps = defaultPolicyDeps,
  now: Date = new Date(),
): Promise<DispatchPolicyDecision> {
  // ── Recipient linkage. Enrichment wins; otherwise resolve from the address alone, which
  //    is what lets a bare transactional caller be gated identically to a campaign send. ──
  let memberId = ctx.memberId ?? null
  let householdId = ctx.householdId ?? null
  let agencyId = ctx.agencyId ?? null
  if (!memberId && !householdId) {
    const link = await deps.resolveContactLink(ctx.channel, ctx.to)
    memberId = link.memberId
    householdId = link.householdId
    agencyId = agencyId ?? link.agencyId
  }

  const effectivePurpose: MessagePurpose = ctx.purpose ?? 'MARKETING'

  // ── Consent, DNC, template, business hours, location — resolved together. ──
  const [
    memberConsentOk,
    contactConsentOk,
    dnc,
    storedTemplateOk,
    withinBusinessHours,
    location,
    convSecurity,
  ] = await Promise.all([
    deps.memberConsent(memberId, ctx.channel),
    memberId ? Promise.resolve(false) : deps.contactConsent(ctx.to, ctx.channel),
    deps.onDNC(ctx.to, ctx.channel),
    deps.templateApproved(ctx.templateId),
    deps.withinBusinessHours(),
    deps.recipientLocation(memberId, householdId, ctx.to, ctx.channel),
    deps.conversationIsSecurity(ctx.conversationId ?? null, householdId),
  ])

  const waiverRevoked = ctx.consentWaived === true
    ? await deps.consentRevoked(memberId, ctx.to, ctx.channel, ctx.purpose)
    : false
  const waiverApplies = ctx.consentWaived === true && !waiverRevoked
  let consent = memberConsentOk || contactConsentOk || ctx.durableConsentGranted === true || waiverApplies

  // ── Gate step 4: approved content. ──
  const approved =
    storedTemplateOk ||
    ctx.templateKind === 'human' ||
    ctx.templateKind === 'system_transactional' ||
    (ctx.templateKind === 'ai_policy' ? await deps.aiPolicyApproved(ctx.aiAuthorAgentKey) : false)

  // ── Purpose policy: frequency always, purpose-scoped consent + collision only on an
  //    EXPLICIT caller purpose (a defaulted purpose must not newly replace channel consent). ──
  const policy = await deps.sendPolicy({
    memberId,
    channel: ctx.channel,
    purpose: effectivePurpose,
    conversationId: ctx.conversationId ?? null,
    activeCampaignPurpose: ctx.activeCampaignPurpose ?? null,
    frequencyPolicyId: ctx.isConversationReply === true ? 'reply' : 'global',
  })
  let collisionPaused: boolean | undefined
  let collisionReason: string | undefined
  if (ctx.purpose) {
    if (policy.consentForPurpose !== null) {
      consent = policy.consentForPurpose || ctx.durableConsentGranted === true || waiverApplies
    }
    collisionPaused = !policy.collision.allowed
    collisionReason = policy.collision.reason
  }

  // ── Business suppression (non-transactional only), fail-closed. ──
  const suppressionEligible = isBusinessSuppressible({
    purpose: ctx.purpose,
    humanAuthored: ctx.templateKind === 'human',
    isTest: ctx.isTest,
    suppressible: ctx.suppressible,
  })
  let businessSuppressed: boolean | undefined
  let suppressionResolved: boolean | undefined
  let suppressionReason: string | undefined
  if (suppressionEligible) {
    const decision = await deps.suppression({
      memberId,
      householdId,
      agencyId,
      contactId: ctx.entity?.type === 'contact' ? ctx.entity.id : null,
      phone: ctx.channel === 'sms' ? ctx.to : null,
      email: ctx.channel === 'email' ? ctx.to : null,
    })
    businessSuppressed = decision.suppressed
    suppressionResolved = decision.resolved
    suppressionReason = decision.reason
  }

  // ── Timezone + quiet hours. ──
  const flagOn = recipientLocalQuietHoursEnabled()
  const timezone = resolveDispatchTimeZone(
    ctx,
    { phone: ctx.recipientPhone ?? location.phone, zip: ctx.recipientZip ?? location.zip },
    flagOn,
    now,
  )

  const floorApplies = quietHoursApply(ctx.channel, ctx.purpose)

  // Configured windows narrow the floor. Loaded only when a scope key names one, so an
  // unconfigured system does exactly one extra no-op lookup and behaves as before.
  const [campaignWindow, workerWindow] = await Promise.all([
    ctx.campaignKey ? deps.hoursWindow(`campaign:${ctx.campaignKey}`) : Promise.resolve(null),
    ctx.workerKey ? deps.hoursWindow(`agent:${ctx.workerKey}`) : Promise.resolve(null),
  ])
  const hasConfiguredWindow = !!campaignWindow || !!workerWindow

  // An unresolved zone only matters when SOMETHING would have used it. A send with no
  // statutory floor and no configured window has nothing to evaluate, so it must not be
  // blocked for a zone it never needed — that would newly break every transactional email.
  const timezoneNeeded = floorApplies || hasConfiguredWindow
  const timezoneResolved = !timezoneNeeded || timezone.resolution.resolved

  let quietHours: QuietHoursDecision | undefined
  let configuredWindowOk: boolean | undefined
  let configuredWindowReason: string | undefined
  let quietHoursExempt = !floorApplies
  if (timezoneNeeded && timezone.localHour != null && timezone.localDay != null) {
    quietHours = evaluateQuietHours({
      localHour: timezone.localHour,
      localDay: timezone.localDay,
      floorApplies,
      campaignWindow,
      workerWindow,
    })
    // The floor verdict is expressed through the gate's existing quiet_hours step so the
    // established escalating-block behavior and its audit action are unchanged.
    quietHoursExempt = quietHours.outcome === 'outside_floor' ? false : true
    if (quietHours.outcome === 'outside_configured_window' || quietHours.outcome === 'window_unsatisfiable') {
      configuredWindowOk = false
      configuredWindowReason = quietHours.reason
    }
  }

  // ── §11/§12 AI authority. Runs HERE because evaluateOutboundMessage needs the consent and
  //    template-approval verdicts resolved just above; re-reading them in the preparation
  //    layer is exactly how two layers come to disagree about the same fact.
  //    An absent/unknown class fails SAFE to draft_only, so unclassified autonomous AI
  //    content is held for the licensed FSA rather than auto-sent.
  let aiAuthority: DispatchPolicyDecision['aiAuthority']
  if (ctx.aiGenerated === true) {
    const { evaluateOutboundMessage } = await import('./evaluations')
    const evaluated = evaluateOutboundMessage({
      draft: ctx.body,
      messageClass: ctx.aiMessageClass,
      purposeClassified: !!ctx.purpose,
      ownershipResolved: ctx.ownershipResolved !== false,
      identityDisclosureSatisfied: ctx.identityDisclosureSatisfied !== false,
      consentCompatible: consent,
      templateApproved: approved,
    })
    aiAuthority = {
      authority: evaluated.authority,
      mayAutoSend: evaluated.mayAutoSend,
      failures: evaluated.failures,
    }
  }

  // Destructured rather than narrowed inline: the test harness compiles this file without
  // --strict, and discriminated-union narrowing is disabled without strictNullChecks — so an
  // inline `resolution.resolved ? … : resolution.reason` would not compile there.
  const tzRes = timezone.resolution
  const unresolvedTimezoneReason = tzRes.resolved === false
    ? `Recipient timezone unresolved (${tzRes.reason}); quiet hours cannot be evaluated.`
    : undefined

  const gateInput: GateInput = {
    draft: ctx.body,
    channel: ctx.channel,
    ownershipResolved: ctx.ownershipResolved,
    ownershipConflict: ctx.ownershipConflict,
    hasConsent: consent,
    // When the floor applies the hour is real; otherwise the step is exempt and the value
    // is inert. Never pass a fabricated in-window hour while claiming the floor applies.
    recipientLocalHour: timezone.localHour ?? 12,
    quietHoursExempt,
    timezoneResolved,
    timezoneReason: unresolvedTimezoneReason,
    configuredWindowOk,
    configuredWindowReason,
    withinBusinessHours: ctx.templateKind === 'human' ? true : withinBusinessHours,
    withinFrequencyCaps: policy.frequency.allowed,
    frequencyReason: policy.frequency.reason,
    collisionPaused,
    collisionReason,
    delegationValid: ctx.delegationValid,
    delegationReason: ctx.delegationReason,
    onDNC: dnc,
    businessSuppressed,
    suppressionResolved,
    suppressionReason,
    usesApprovedTemplateOrPolicy: approved,
    approvedHumanTemplate: approved === true && !!ctx.templateId && ctx.templateKind !== 'ai_policy',
    personalizationResolved: ctx.personalizationResolved,
    personalizationReason: ctx.personalizationReason,
    // Firewall: the caller's flag OR the server-resolved conversation/household flag. It
    // can only ever get MORE restrictive here — a caller cannot clear it by omission.
    isSecurity: ctx.isSecurity === true || convSecurity,
    smsLive: deps.smsLive(ctx.channel),
    dataConfidenceOk: ctx.dataConfidenceOk,
    dataConfidenceReason: ctx.dataConfidenceReason,
    aiAuthorityOk: aiAuthority ? aiAuthority.mayAutoSend : undefined,
    aiAuthorityReason: aiAuthority && !aiAuthority.mayAutoSend
      ? `AI message class "${ctx.aiMessageClass || 'unclassified'}" is not auto-send (${aiAuthority.failures.join(',') || aiAuthority.authority}); drafted for the FSA.`
      : undefined,
  }

  const gate = evaluateGate(gateInput)

  return {
    gate,
    allowed: gate.allowed,
    timezone,
    quietHours,
    aiAuthority,
    resolved: {
      memberId,
      householdId,
      agencyId,
      consent,
      onDNC: dnc,
      suppressed: businessSuppressed,
    },
  }
}
