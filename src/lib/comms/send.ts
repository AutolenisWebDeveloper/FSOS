// src/lib/comms/send.ts
// P1 send-time gate binding. Every automated SMS/email in FSOS goes through
// sendThroughGate(): it computes the 7-step gate context FRESH from the database
// AT SEND TIME (consent, DNC, recipient-local quiet hours, template approval,
// securities flag), routes the message through the dispatcher (which runs the pure
// gate and escalates on block), and records a comm_messages row with the gate
// result. There is deliberately no bypass path (WF-5 invariant).
//
// On top of the gate, this layer now also:
//   • threads the send into the ONE conversation for (channel, contact) and
//     auto-associates it to member → household → agency (full history), and
//   • personalizes merge tokens, instruments outbound EMAIL with open/click
//     tracking, captures the provider id, and writes delivery-lifecycle events.
//
// The critical guarantee is unchanged: consent/DNC/quiet-hours are re-checked here
// at send time, not just at enrollment time (WF-9 invariant).

import { getDb } from '@/lib/supabase/client'
import { dispatch, type DispatchRequest } from './dispatcher'
import type { GateResult } from './gate'
import { getOrCreateConversation, touchConversation, normalizeContact, type Channel } from './conversations'
import { loadHoursPolicy, isWithinOperatingHours } from './hours'
import { recordMessageEvent } from './events'
import { personalize, type RecipientContext } from './personalize'
import { instrumentEmailHtml } from './tracking'
import { resolveDelegation, enqueueAssignmentReview } from './ownership'
import { resolveIdentityDisclosure, type IdentityContext } from './identity-resolver'
import { prependIdentityDisclosure } from './identity'
import { resolveSendPolicy } from './policy-resolver'
import type { MessagePurpose } from './purpose'
import { evaluateOutboundMessage } from './evaluations'
import type { AiMessageClass } from './ai-authority'
import { evaluateDataConfidence, type ClaimField } from './data-confidence'

export interface SendContext {
  channel: Channel
  /** Recipient phone (sms) or email (email). */
  to: string
  subject?: string
  body: string
  /**
   * Email plaintext part (Slice 9B, ADR-025) — the template's STORED body_text. Personalized
   * with the same merge tokens as the HTML and sent as the multipart text part. Absent → the
   * email is single-part HTML (existing behavior). Ignored for SMS.
   */
  bodyText?: string
  actor: string
  /** The member this send targets (for consent lookup). */
  memberId?: string | null
  /**
   * Explicit, additive consent signal for a domain that owns its OWN durable per-channel
   * consent-evidence store rather than the member-keyed `consents` table — specifically the
   * workshop engine, whose registrants have no household member until conversion but DO
   * carry durable granted consent in `workshop_consent_events`. When the caller sets this
   * true, it is OR'd into gate step 1 (never reduces restrictiveness for existing callers,
   * who leave it undefined). The caller MUST have verified a durable `granted` (not later
   * `revoked`) row for this exact channel. DNC (step 3, incl. STOP opt-outs), quiet-hours
   * (2), recommendation (5), and securities (6) are STILL enforced independently.
   */
  durableConsentGranted?: boolean
  householdId?: string | null
  agencyId?: string | null
  policyId?: string | null
  /** The record this send is about (for audit + timeline linkage). */
  entity?: { type: string; id: string }
  /** Template used — must be approved to pass gate step 4. */
  templateId?: string | null
  /** Record/recipient securities flag (firewall). */
  isSecurity?: boolean
  /** Recipient IANA-ish timezone offset from UTC in hours (default Central, -6/-5). */
  utcOffsetHours?: number
  campaignId?: string | null
  campaignVariant?: string | null
  sequenceStep?: number | null
  /** Reuse an existing thread (inbound handler passes it); else resolved here. */
  conversationId?: string | null
  /** Merge-token values for personalization (green-zone content substitution). */
  recipientContext?: RecipientContext
  /** Flag AI-authored sends (still gate-checked) for audit + UI. */
  aiGenerated?: boolean
  /**
   * The agent that authored an AI send with no fixed template. Its per-agent kill
   * switch (plus the global gateway) is what satisfies gate step 4 for that send —
   * disable the agent and its outreach immediately blocks + escalates. Defaults to
   * the conversation responder. Ignored unless aiGenerated && no templateId.
   */
  aiAuthorAgentKey?: string
  /**
   * The AI message CLASS (§11, Slice 5). When set on an aiGenerated send, the authority
   * matrix + §12 evaluations run BEFORE dispatch: a draft-only/blocked class or any
   * evaluation failure is NOT auto-sent — it is recorded as a draft on agent_actions and
   * escalated to the licensed FSA. Absent → existing behavior (the gate's approved-AI-
   * policy check still governs). Enforced through code + classification, not prompts.
   */
  aiMessageClass?: AiMessageClass | string
  /**
   * A 1:1 reply personally typed by an authenticated, licensed operator (the FSA
   * inbox). The human IS the content approval for gate step 4 — but recommendation
   * (5), securities (6), consent (1), quiet-hours (2), and DNC (3) are STILL
   * enforced. Never set this for bulk/automated/AI sends.
   */
  humanAuthored?: boolean
  /**
   * Delegated on-behalf-of context (Slice 1). Set ONLY when the FSA is communicating on
   * behalf of an agency owner. When present, send.ts resolves the ACTIVE, in-scope
   * delegation FRESH at send time (ownership.ts → delegation.ts) and passes the result
   * to the gate (step `delegation`). An invalid delegation HARD-blocks + escalates.
   * Absent → the send is not on-behalf-of anyone and the delegation step is a no-op.
   */
  delegation?: {
    agencyId: string
    campaignType?: string | null
    senderUserId?: string | null
  }
  /**
   * Authoritative ownership attribution to persist on the comm_messages row (§7 — the
   * ACTUAL sender and the REPRESENTED party stay distinct, never one ambiguous field).
   */
  ownership?: {
    actualSenderUserId?: string | null
    representedAgentId?: string | null
    representedAgencyOwnerId?: string | null
    representedAgencyId?: string | null
    contactOwnerId?: string | null
    communicationOperatorId?: string | null
    bookOfBusinessRef?: string | null
    delegationId?: string | null
  }
  /**
   * When the caller has already determined ownership cannot be resolved (§6), set false:
   * the gate blocks on step `ownership` and the record is routed to the assignment-review
   * queue instead of sending. Defaults to resolved.
   */
  ownershipResolved?: boolean
  /** Human-readable reason ownership is unresolved (surfaced in the review queue + audit). */
  ownershipConflict?: string
  /**
   * First-contact identity disclosure context (Slice 2, §8). When present, the PLATFORM
   * decides whether a full introduction is required for this (channel, contact) and
   * AUTO-PREPENDS the approved disclosure — the author never inserts it. Absent → no
   * identity governance (existing callers unaffected). A full intro is only auto-inserted
   * when an APPROVED comm_identity_config exists (never fabricates the Farmers wording).
   */
  identity?: IdentityContext
  /**
   * Message purpose (Slice 3, §9). When provided, the send path applies purpose-scoped
   * consent + frequency caps + priority-collision (policy-resolver.ts) and records the
   * purpose on the message. Absent → no purpose-policy governance (existing callers
   * unaffected; channel-wide consent is used as today).
   */
  purpose?: MessagePurpose
  /** The highest-priority OTHER campaign purpose active for this recipient (collision, §10). */
  activeCampaignPurpose?: MessagePurpose | null
  /**
   * Data-confidence context (Slice 6, §13). Set when the message makes SPECIFIC claims
   * (a conversion deadline, product ownership, lapse/age status, …): pass the fields those
   * claims depend on. An unverified/conflicting field excludes the send (gate step
   * data_confidence) and raises a verification task — never sent on a guess. Absent → no
   * specific-claim constraint (generic invitations are unaffected).
   */
  dataConfidence?: { makesSpecificClaims: boolean; claims: ClaimField[]; minConfidence?: number }
}

export interface SendOutcome {
  sent: boolean
  blocked: boolean
  gate: GateResult
  messageId?: string
  conversationId?: string
  reason?: string
}

/** Conservative Central-time offset (TX). CDT = -5, CST = -6; use -6 as the floor. */
const DEFAULT_UTC_OFFSET = -6

function recipientLocalHour(utcOffsetHours = DEFAULT_UTC_OFFSET): number {
  const utcHour = new Date().getUTCHours()
  const local = (utcHour + utcOffsetHours + 24) % 24
  return local
}

/** True if the named comm template exists and is approved (gate step 4). */
export async function isTemplateApproved(templateId: string | null | undefined): Promise<boolean> {
  if (!templateId) return false
  try {
    const { data } = await getDb()
      .from('comm_templates')
      .select('approval_status, archived_at')
      .eq('id', templateId)
      .maybeSingle()
    return data?.approval_status === 'approved' && !data?.archived_at
  } catch {
    return false
  }
}

/** Valid granted consent on this channel for this member (gate step 1). */
async function hasConsent(memberId: string | null | undefined, channel: Channel): Promise<boolean> {
  if (!memberId) return false
  try {
    const { data } = await getDb()
      .from('consents')
      .select('status')
      .eq('member_id', memberId)
      .eq('channel', channel)
      .maybeSingle()
    return data?.status === 'granted'
  } catch {
    return false
  }
}

/**
 * "Approved AI policy" for gate step 4 — the non-template path for AI-authored
 * green-zone messages (CLAUDE.md §7: "approved template OR approved AI policy").
 * A policy is approved only when BOTH kill switches are on: the global AI gateway
 * AND the specific agent that authored the message (the conversation responder for
 * inbound replies; the acting outreach agent — cross_sell / term_conversion /
 * referral_followup / marketing_automation — for proactive workforce outreach).
 * This keeps every AI auto-send fully operator-controlled: disabling either switch
 * immediately blocks + escalates instead of sending. It only satisfies step 4; the
 * AI draft still must clear recommendation (5), securities (6), consent (1),
 * quiet-hours (2), and DNC (3).
 */
async function hasApprovedAiPolicy(agentKey = 'conversation'): Promise<boolean> {
  if (process.env.AI_GATEWAY_DISABLED === '1') return false
  try {
    const db = getDb()
    const [{ data: pol }, { data: agent }] = await Promise.all([
      db.from('ai_policies').select('gateway_enabled').eq('id', 'global').maybeSingle(),
      db.from('ai_agents').select('enabled').eq('key', agentKey).maybeSingle(),
    ])
    const gatewayOn = pol?.gateway_enabled !== false
    return gatewayOn && agent?.enabled === true
  } catch {
    return false
  }
}

/** Recipient on internal/external DNC for this channel (gate step 3). */
async function onDNC(to: string, channel: Channel): Promise<boolean> {
  try {
    const { data } = await getDb()
      .from('dnc_entries')
      .select('id')
      .eq('contact', to)
      .in('channel', [channel, 'all'])
      .limit(1)
    return Array.isArray(data) && data.length > 0
  } catch {
    // Fail safe: if we cannot verify DNC, treat as blocked (never send blindly).
    return true
  }
}

/**
 * Send one message through the full 7-step gate, computed at send time.
 * On block: dispatcher records the compliance_event + escalation; we log the
 * comm_messages row as blocked with the failing step. Never sends on block.
 */
export async function sendThroughGate(ctx: SendContext): Promise<SendOutcome> {
  const db = getDb()
  const to = normalizeContact(ctx.channel, ctx.to)

  // Resolve the conversation thread up front so we have its id for the row + tracking.
  let conversationId = ctx.conversationId ?? null
  let convMemberId = ctx.memberId ?? null
  let convHouseholdId = ctx.householdId ?? null
  let convAgencyId = ctx.agencyId ?? null
  if (!conversationId) {
    const conv = await getOrCreateConversation(ctx.channel, to)
    if (conv) {
      conversationId = conv.id
      convMemberId = convMemberId ?? conv.member_id
      convHouseholdId = convHouseholdId ?? conv.household_id
      convAgencyId = convAgencyId ?? conv.agency_id
    }
  }

  // Personalize merge tokens (safe substitution; the gate still checks the result).
  const personalized = personalize(ctx.body, ctx.recipientContext ?? {})
  // Slice 9B — the stored plaintext part, personalized the same way (email multipart).
  const personalizedText = ctx.bodyText ? personalize(ctx.bodyText, ctx.recipientContext ?? {}) : undefined

  // First-contact identity disclosure (§8). The platform decides + auto-prepends the
  // approved disclosure when a full introduction is required; the author never inserts
  // it. The prepended text is included BEFORE the gate runs, so the full message (incl.
  // disclosure) is compliance-checked. Absent ctx.identity → no change.
  let identityFullIntro: boolean | null = null
  let identityFirstTouch: boolean | null = null
  let identityVersion: number | null = null
  let identityReason: string | null = null
  let identityBody = personalized
  let identityText = personalizedText
  if (ctx.identity) {
    const idr = await resolveIdentityDisclosure({
      channel: ctx.channel,
      conversationId,
      ctx: ctx.identity,
    })
    // identity_full_intro records what was ACTUALLY prepended, not merely what was
    // required: when no approved config exists, idr.disclosure is null and no full intro
    // is sent — the (unmet) requirement is still captured in identityReason for audit.
    identityFullIntro = idr.disclosure != null
    identityFirstTouch = idr.isFirstChannelTouch
    identityVersion = idr.disclosure != null ? idr.version : null
    identityReason = idr.reason
    if (idr.disclosure) {
      identityBody = prependIdentityDisclosure(idr.disclosure, personalized)
      if (personalizedText) identityText = prependIdentityDisclosure(idr.disclosure, personalizedText)
    }
  }

  // Compute the gate context FRESH (send-time re-check — WF-9 invariant). Step 4
  // is satisfied by an approved template OR, for AI-authored replies with no
  // template, an approved AI policy (both AI kill switches on).
  const [memberConsent, dnc, templateApproved, hoursPolicy] = await Promise.all([
    hasConsent(convMemberId, ctx.channel),
    onDNC(to, ctx.channel),
    isTemplateApproved(ctx.templateId),
    loadHoursPolicy(),
  ])
  // Gate step 1: member-keyed consent OR a domain-owned durable per-channel grant
  // (workshops). The OR can only ADD consent an existing caller never asserted; it never
  // removes it. DNC/quiet-hours/recommendation/securities remain enforced below.
  let consent = memberConsent || ctx.durableConsentGranted === true

  // Purpose policy (Slice 3, §9/§10): purpose-scoped consent + frequency caps + priority
  // collision. Opt-in via ctx.purpose. Purpose-scoped consent (when a row exists) REPLACES
  // the channel-wide check — a purpose-level revoke must win over a channel grant; a
  // durable workshop grant can still OR in. Frequency/collision become non-escalating gate
  // deferrals. Absent ctx.purpose → unchanged behavior.
  let withinFrequencyCaps: boolean | undefined
  let frequencyReason: string | undefined
  let collisionPaused: boolean | undefined
  let collisionReason: string | undefined
  if (ctx.purpose) {
    const policy = await resolveSendPolicy({
      memberId: convMemberId,
      channel: ctx.channel,
      purpose: ctx.purpose,
      conversationId,
      activeCampaignPurpose: ctx.activeCampaignPurpose ?? null,
    })
    if (policy.consentForPurpose !== null) {
      consent = policy.consentForPurpose || ctx.durableConsentGranted === true
    }
    withinFrequencyCaps = policy.frequency.allowed
    frequencyReason = policy.frequency.reason
    collisionPaused = !policy.collision.allowed
    collisionReason = policy.collision.reason
  }

  // Data confidence (Slice 6, §13): a message making SPECIFIC claims on unverified/
  // conflicting data is excluded (gate step data_confidence) and a verification task is
  // raised. Opt-in via ctx.dataConfidence; a generic invitation passes.
  let dataConfidenceOk: boolean | undefined
  let dataConfidenceReason: string | undefined
  let dataConfidenceUnverified: string[] = []
  if (ctx.dataConfidence) {
    const dc = evaluateDataConfidence(ctx.dataConfidence)
    dataConfidenceOk = dc.allowed
    dataConfidenceReason = dc.reason
    dataConfidenceUnverified = dc.unverified
  }
  // Operator hours of operation (business-local). A human-typed 1:1 reply from the
  // FSA inbox is NOT gated by business hours — the licensed operator is present and
  // choosing to send. Automated/AI/bulk sends ARE gated (held outside hours).
  const withinBusinessHours = ctx.humanAuthored === true ? true : await isWithinOperatingHours(hoursPolicy)
  const approved =
    templateApproved ||
    ctx.humanAuthored === true ||
    (ctx.aiGenerated === true && !ctx.templateId ? await hasApprovedAiPolicy(ctx.aiAuthorAgentKey) : false)

  // On-behalf-of authority (Slice 1). Resolved FRESH here (never from an enrollment
  // snapshot). Absent delegation context → not an on-behalf-of send → step is a no-op.
  let delegationValid: boolean | undefined
  let delegationReason: string | undefined
  let resolvedDelegationId: string | null = ctx.ownership?.delegationId ?? null
  if (ctx.delegation) {
    const dec = await resolveDelegation({
      agencyId: ctx.delegation.agencyId,
      channel: ctx.channel,
      campaignType: ctx.delegation.campaignType ?? null,
      senderUserId: ctx.delegation.senderUserId ?? null,
      contactAgencyId: convAgencyId ?? null,
    })
    delegationValid = dec.valid
    delegationReason = dec.reason
    resolvedDelegationId = dec.delegationId ?? resolvedDelegationId
  }

  // Pre-insert the message row (queued) so email tracking can reference its id and
  // so a blocked send is still visible in the timeline. The final status/provider
  // id are patched after dispatch.
  let messageId: string | undefined
  try {
    const { data } = await db
      .from('comm_messages')
      .insert({
        channel: ctx.channel,
        direction: 'outbound',
        recipient: to,
        subject: ctx.subject ?? null,
        body: identityBody,
        delivery_status: 'queued',
        template_id: ctx.templateId ?? null,
        campaign_id: ctx.campaignId ?? null,
        campaign_variant: ctx.campaignVariant ?? null,
        sequence_step: ctx.sequenceStep ?? null,
        conversation_id: conversationId,
        member_id: convMemberId,
        household_id: convHouseholdId,
        agency_id: convAgencyId,
        policy_id: ctx.policyId ?? null,
        entity_type: ctx.entity?.type ?? (convHouseholdId ? 'household' : 'conversation'),
        entity_id: ctx.entity?.id ?? convHouseholdId ?? conversationId,
        consent_at_send: consent,
        actor: ctx.actor,
        ai_generated: ctx.aiGenerated === true,
        // Slice 1 — distinct actual-sender vs represented-party attribution (§7).
        actual_sender_user_id: ctx.ownership?.actualSenderUserId ?? null,
        represented_agent_id: ctx.ownership?.representedAgentId ?? null,
        represented_agency_owner_id: ctx.ownership?.representedAgencyOwnerId ?? null,
        // For an on-behalf-of send the authoritative represented agency is the delegation's
        // agency; prefer explicit ownership, then delegation, then the conversation's agency.
        represented_agency_id:
          ctx.ownership?.representedAgencyId ?? ctx.delegation?.agencyId ?? convAgencyId ?? null,
        contact_owner_id: ctx.ownership?.contactOwnerId ?? null,
        communication_operator_id: ctx.ownership?.communicationOperatorId ?? null,
        book_of_business_ref: ctx.ownership?.bookOfBusinessRef ?? null,
        delegation_id: resolvedDelegationId,
        // Slice 2 — what identity disclosure the platform applied to this send (§8).
        identity_full_intro: identityFullIntro,
        is_first_channel_touch: identityFirstTouch,
        identity_disclosure_version: identityVersion,
        identity_disclosure_reason: identityReason,
        // Slice 3 — record the classified purpose (§9: frequency counting + analytics).
        purpose: ctx.purpose ?? null,
        queued_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle()
    messageId = data?.id
  } catch {
    /* best-effort; dispatcher still writes the durable audit + escalation */
  }

  // Instrument outbound email with open/click tracking (needs the message id). The body
  // already includes any auto-prepended identity disclosure (identityBody).
  const sendBody =
    ctx.channel === 'email' && messageId ? instrumentEmailHtml(identityBody, messageId) : identityBody

  const req: DispatchRequest = {
    channel: ctx.channel,
    to,
    subject: ctx.subject,
    body: sendBody,
    // Plaintext part is NOT instrumented (open/click tracking is HTML-only).
    bodyText: ctx.channel === 'email' ? identityText : undefined,
    actor: ctx.actor,
    entity: ctx.entity ?? (conversationId ? { type: 'conversation', id: conversationId } : undefined),
    gate: {
      ownershipResolved: ctx.ownershipResolved,
      ownershipConflict: ctx.ownershipConflict,
      hasConsent: consent,
      recipientLocalHour: recipientLocalHour(ctx.utcOffsetHours),
      withinBusinessHours,
      withinFrequencyCaps,
      frequencyReason,
      collisionPaused,
      collisionReason,
      delegationValid,
      delegationReason,
      onDNC: dnc,
      usesApprovedTemplateOrPolicy: approved,
      isSecurity: ctx.isSecurity === true,
      dataConfidenceOk,
      dataConfidenceReason,
    },
  }

  // AI authority matrix + §12 evaluations (Slice 5). For a CLASSIFIED AI send, evaluate
  // before dispatch: a draft-only/blocked class or any evaluation failure is never
  // auto-sent — it is recorded as a draft on agent_actions and escalated to the FSA.
  if (ctx.aiGenerated === true && ctx.aiMessageClass) {
    const identitySatisfied = !ctx.identity ? true : identityFirstTouch ? identityFullIntro === true : true
    const evalResult = evaluateOutboundMessage({
      draft: identityBody,
      messageClass: ctx.aiMessageClass,
      purposeClassified: !!ctx.purpose,
      ownershipResolved: ctx.ownershipResolved !== false,
      identityDisclosureSatisfied: identitySatisfied,
      consentCompatible: consent,
      templateApproved: approved,
    })
    if (!evalResult.mayAutoSend) {
      // Hold as a human-review draft (not sent). Record the AI action + escalate.
      try {
        await db.from('agent_actions').insert({
          kind: 'ai_draft',
          actor: ctx.actor,
          outcome: evalResult.authority === 'blocked' ? 'blocked' : 'drafted',
          target_type: ctx.entity?.type ?? 'conversation',
          target_id: ctx.entity?.id ?? convHouseholdId ?? conversationId,
          reason: evalResult.failures.length ? evalResult.failures.join(',') : `authority:${evalResult.authority}`,
          note: `ai message class "${ctx.aiMessageClass}" → ${evalResult.authority}; not auto-sent (§11/§12)`,
          drafted_content: identityBody,
        })
      } catch {
        /* best-effort; the message row below still records the hold */
      }
      if (messageId) {
        try {
          await db.from('comm_messages').update({
            delivery_status: 'blocked',
            blocked_step: 'ai_authority',
            block_reason: evalResult.failures.length ? evalResult.failures.join(',') : `draft_only:${evalResult.authority}`,
            updated_at: new Date().toISOString(),
          }).eq('id', messageId)
        } catch { /* best-effort */ }
      }
      await recordMessageEvent({
        messageId,
        conversationId,
        campaignId: ctx.campaignId ?? null,
        event: 'failed',
        channel: ctx.channel,
        detail: `ai_authority:${evalResult.authority}`,
      })
      return {
        sent: false,
        blocked: true,
        gate: { allowed: false, escalate: true, reason: `AI message held for human review (${evalResult.authority}).` },
        messageId,
        conversationId: conversationId ?? undefined,
        reason: `AI message class "${ctx.aiMessageClass}" is not auto-send (${evalResult.failures.join(',') || evalResult.authority}); drafted for the FSA.`,
      }
    }
  }

  const result = await dispatch(req)

  // Patch the pre-inserted row with the outcome + provider id.
  if (messageId) {
    try {
      await db
        .from('comm_messages')
        .update({
          delivery_status: result.sent ? 'sent' : 'blocked',
          blocked_step: result.gate.blockedStep ?? null,
          block_reason: result.gate.reason ?? null,
          provider: result.sent ? (ctx.channel === 'sms' ? 'twilio' : 'resend') : null,
          provider_id: result.providerId ?? null,
          sent_at: result.sent ? new Date().toISOString() : null,
          error: result.error ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
    } catch {
      /* best-effort */
    }
  }

  // Unresolved ownership → route to the assignment-review queue (§6). The gate has
  // already blocked the send; this is the human-resolution recovery path.
  if (!result.sent && result.gate.blockedStep === 'ownership') {
    await enqueueAssignmentReview({
      channel: ctx.channel,
      destination: to,
      memberId: convMemberId,
      householdId: convHouseholdId,
      agencyId: convAgencyId ?? ctx.delegation?.agencyId ?? null,
      campaignId: ctx.campaignId ?? null,
      reason: ctx.ownershipConflict ?? result.gate.reason ?? 'Ownership could not be resolved.',
      conflict: { ownershipConflict: ctx.ownershipConflict ?? null },
    })
  }

  // Data-confidence exclusion → raise a verification task (§13). The gate blocked the
  // send; this is the recovery path (verify the field, then re-enable). Best-effort.
  if (!result.sent && result.gate.blockedStep === 'data_confidence') {
    try {
      // The dispatcher already wrote the comms.blocked audit for this gate block; here we
      // only add the operator-facing verification task (the §13 recovery path).
      await db.from('work_tasks').insert({
        title: `Verify data before sending: ${dataConfidenceUnverified.join(', ') || 'unverified claim'}`,
        entity_type: convHouseholdId ? 'household' : 'conversation',
        entity_id: convHouseholdId ?? conversationId,
        source: 'workflow',
      })
    } catch {
      /* best-effort — the gate has already blocked + escalated the send */
    }
  }

  // Record the per-channel identity state on the thread once a FULL introduction has
  // actually been sent (§8), so subsequent sends on this channel use the abbreviated form
  // until a refresh condition (new sender/purpose, reassignment, inactivity) recurs.
  if (result.sent && conversationId && identityFullIntro && ctx.identity) {
    try {
      await db
        .from('comm_conversations')
        .update({
          identity_disclosed_at: new Date().toISOString(),
          identity_disclosure_version: identityVersion,
          identity_sender_user_id: ctx.identity.senderUserId ?? null,
          identity_purpose: ctx.identity.purpose ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
    } catch {
      /* best-effort — the message row already records what was disclosed */
    }
  }

  // Record the lifecycle event + advance the thread recency.
  await recordMessageEvent({
    messageId,
    conversationId,
    campaignId: ctx.campaignId ?? null,
    event: result.sent ? 'sent' : 'failed',
    channel: ctx.channel,
    detail: result.sent ? null : result.gate.blockedStep ?? result.error ?? 'blocked',
    providerId: result.providerId ?? null,
  })
  if (result.sent && conversationId) await touchConversation(conversationId, 'outbound')

  return {
    sent: result.sent,
    blocked: !result.sent,
    gate: result.gate,
    messageId,
    conversationId: conversationId ?? undefined,
    reason: result.gate.reason,
  }
}
