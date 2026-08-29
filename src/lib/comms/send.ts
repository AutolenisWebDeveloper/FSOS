// src/lib/comms/send.ts
// P1 send-time gate binding. Every automated SMS/email in FSOS goes through
// sendMessage(): it computes the 7-step gate context FRESH from the database
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
import { writeAudit } from '@/lib/audit/log'
import { dispatch, type DispatchRequest } from './dispatcher'
import type { GateResult } from './gate'
import { getOrCreateConversation, touchConversation, normalizeContact, type Channel } from './conversations'
import { recordMessageEvent } from './events'
import { personalize, unresolvedBlockingTokens, type RecipientContext } from './personalize'
import { BUSINESS } from '@/lib/site'
import { emailUnsubscribeUrl } from './unsubscribe'
import { instrumentEmailHtml } from './tracking'
import { wrapMarketingEmailBody } from '@/lib/notifications/email-shell'
import { resolveDelegation, enqueueAssignmentReview, resolveAgentOfRecord, type AgentOfRecord } from './ownership'
import { buildRecipientContext } from './variables'
import { resolvePolicySource } from './policy-context'
import { resolveIdentityDisclosure, type IdentityContext } from './identity-resolver'
import { prependIdentityDisclosure } from './identity'
import { parseSubjectFromBody } from './template-subject'
import type { MessagePurpose } from './purpose'
import type { AiMessageClass } from './ai-authority'
import { evaluateDataConfidence, type ClaimField } from './data-confidence'
import { streamForPurpose } from './senders'
import type { TemplateKind } from './dispatch-policy'

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
   * (2, where it applies — SMS marketing scope, purpose.ts), recommendation (5), and
   * securities (6) are STILL enforced independently.
   */
  durableConsentGranted?: boolean
  /**
   * Console / self-test CONSENT WAIVER (ADR-033). Set ONLY by the operator-initiated
   * individual-send surfaces — the Communications Console's 1:1 SMS/email send, an operator-
   * initiated AI conversation opener, and a verified-self test send. It relaxes EXACTLY ONE
   * thing: the "valid channel consent on file" requirement (gate step 1), because a licensed
   * operator sending a single 1:1 message, and a test to a destination the operator owns and
   * verified, are not the automated mass-marketing case that consent-on-file exists to gate.
   *
   * It is NARROW and OPT-OUT-SAFE:
   *   • It never fires when the recipient has an EXPLICIT opt-out/revoke (member-level
   *     `consents.status='revoked'`, a purpose-scoped revoke, or a latest contact-level
   *     `revoked`) — an opt-out always wins (consentRevoked below, fail-safe).
   *   • It relaxes ONLY step 1. Quiet hours (2, per its SMS-marketing scope), DNC/STOP (3),
   *     approved-template/AI-policy (4), personalization (4b), recommendation red-line (5),
   *     the securities firewall (6), data confidence (6b), delegation, A2P go-live, and
   *     frequency/collision ALL still apply exactly as for any other send. There is still no way to send a securities recommendation
   *     or reach an opted-out recipient from the console.
   * Absent/false → unchanged behavior (consent-on-file is required), so no bulk/campaign/agent
   * caller is affected.
   */
  consentWaived?: boolean
  householdId?: string | null
  agencyId?: string | null
  policyId?: string | null
  /** The record this send is about (for audit + timeline linkage). */
  entity?: { type: string; id: string }
  /** Template used — must be approved to pass gate step 4. */
  templateId?: string | null
  /** Record/recipient securities flag (firewall). */
  isSecurity?: boolean
  /**
   * Recipient timezone offset from UTC in hours, for callers that have ALREADY resolved
   * a per-recipient offset from a real IANA zone (the workshop engine). When absent, the
   * recipient-local hour is resolved DST-correctly from `timeZone` instead.
   */
  utcOffsetHours?: number
  /**
   * Recipient IANA timezone identifier (e.g. 'America/Chicago'). Used to resolve the
   * recipient-local hour for the quiet-hours floor when no explicit `utcOffsetHours` is
   * given. Defaults to America/Chicago (DST-correct via Intl — the old fixed -6 default
   * was an hour off during CDT).
   */
  timeZone?: string
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
   * (5), securities (6), consent (1), and DNC (3) are STILL enforced. Quiet hours (2)
   * still applies to a human-typed SMS UNLESS the contact sent an inbound message
   * within the preceding 24h (live conversation — resolved server-side, fails closed).
   * Never set this for bulk/automated/AI sends.
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
   * This send is a REPLY to an inbound message on a live conversation thread, not proactive
   * outreach. It selects the `reply` row of comm_frequency_policy instead of `global`
   * (migration 103, ADR-017 amendment): the §9 caps were written to space out drip touches,
   * and their minimum-interval spacing stalls a normal back-and-forth after one AI turn.
   *
   * It SELECTS a cap row — it never removes one. Both rows are real, operator-editable
   * ceilings, and a missing `reply` row falls back to the tighter `global` caps. Every other
   * gate step (consent, quiet hours, DNC, approved template/AI policy, recommendation,
   * securities firewall, data confidence, A2P) applies exactly as for any other send, and a
   * capped reply is escalated to the FSA by the conversation path, never silently dropped.
   * Absent/false → the outreach caps, so no campaign caller is affected.
   */
  isConversationReply?: boolean
  /**
   * Data-confidence context (Slice 6, §13). Set when the message makes SPECIFIC claims
   * (a conversion deadline, product ownership, lapse/age status, …): pass the fields those
   * claims depend on. An unverified/conflicting field excludes the send (gate step
   * data_confidence) and raises a verification task — never sent on a guess. Absent → no
   * specific-claim constraint (generic invitations are unaffected).
   */
  dataConfidence?: { makesSpecificClaims: boolean; claims: ClaimField[]; minConfidence?: number }
  /**
   * Communications Command Console send provenance (spec §3.1). Purely descriptive
   * metadata persisted on the comm_messages row so a console send is traceable to its
   * source and a TEST send is excludable from production analytics. It NEVER affects the
   * gate — the console adds no send path (spec §0). Absent → source_kind defaults to
   * 'blank' at the DB level; existing callers are unaffected.
   */
  sourceKind?: 'blank' | 'campaign_asset' | 'agent_seed' | 'test'
  sourceCampaignKey?: string | null
  sourceAssetId?: string | null
  sourceAssetTable?: string | null
  /**
   * Marks a per-campaign TEST send (spec §B4). Still a REAL gated send to a verified self
   * destination — it proves the pipeline — but the row is flagged so production campaign
   * KPIs exclude it. The gate, consent, quiet hours, STOP/HELP and AI authority all still
   * apply exactly as for a live send; is_test grants NO exemption.
   */
  isTest?: boolean
  /**
   * Explicit BUSINESS-suppression opt-out for a KNOWN transactional/servicing send that
   * carries no marketing purpose (e.g. appointment reminders, which are quiet-hours-gated for
   * safety but must never be book-suppressed). Set FALSE to declare the send non-suppressible.
   * Absent → suppressibility is derived from the purpose (businessSuppressionApplies) and the
   * send's nature (human-authored / test sends are never business-suppressed). This is the
   * narrow, explicit escape hatch for correctly-classified transactional automation — it never
   * relaxes consent, DNC, quiet hours, or any regulatory control.
   */
  suppressible?: boolean
  /**
   * Declares a fixed, CODE-RESIDENT transactional notice (a booking confirmation, a visitor
   * acknowledgement, a password-setup mail). These have no `comm_templates` row because they
   * are not operator-authored, but they are real reviewed templates that change only through
   * code review — so declaring this satisfies gate step 4. It relaxes NOTHING else: consent,
   * DNC, suppression, the red line and the securities firewall all still run. This is the
   * declaration that let the nine previously-ungated paths join the gated path without a
   * bypass being invented for them.
   */
  systemTransactional?: boolean
  /** Recipient phone for NPA timezone resolution, when the caller already has it. */
  recipientPhone?: string | null
  /** Recipient ZIP for the secondary timezone resolution, when the caller already has it. */
  recipientZip?: string | null
}

export interface SendOutcome {
  sent: boolean
  blocked: boolean
  gate: GateResult
  messageId?: string
  conversationId?: string
  reason?: string
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

/**
 * PREPARE and send one message.
 *
 * This is no longer a gate wrapper — the name `sendMessage` is gone with the role. The
 * checks it used to run (consent, DNC, suppression, quiet hours, approved template, the
 * red line, the securities firewall) now run at the DISPATCH CHOKEPOINT in lib/messaging.ts,
 * where they also cover the nine paths that never called this function.
 *
 * What happens here is everything a message needs BEFORE a policy decision can be made
 * about it: thread it into the one conversation for (channel, contact), resolve its
 * subject, substitute merge tokens and fail closed on an unresolved blocking one, prepend
 * the platform identity disclosure, write the §13.9 message-of-record, wrap the branded
 * shell and instrument tracking. The chokepoint then decides, and the outcome is patched
 * back onto the record here.
 */
export async function sendMessage(ctx: SendContext): Promise<SendOutcome> {
  const db = getDb()
  const to = normalizeContact(ctx.channel, ctx.to)

  // Resolve the conversation thread up front so we have its id for the row + tracking.
  let conversationId = ctx.conversationId ?? null
  let convMemberId = ctx.memberId ?? null
  let convHouseholdId = ctx.householdId ?? null
  let convAgencyId = ctx.agencyId ?? null
  // Server-derived securities-firewall signal (§4.1). The conversation persists the
  // household's securities flag (getOrCreateConversation → conversationIsSecurity); we
  // OR it with any caller-supplied ctx.isSecurity below so the firewall can NEVER be
  // bypassed by a call site that omits or falsifies the flag (e.g. the one-off send
  // route, which accepts a client-supplied is_security). Defense in depth: the firewall
  // only ever gets MORE restrictive here, never less.
  let convIsSecurity = false
  if (!conversationId) {
    const conv = await getOrCreateConversation(ctx.channel, to)
    if (conv) {
      conversationId = conv.id
      convMemberId = convMemberId ?? conv.member_id
      convHouseholdId = convHouseholdId ?? conv.household_id
      convAgencyId = convAgencyId ?? conv.agency_id
      convIsSecurity = conv.is_security === true
    }
  } else {
    // Reusing an existing thread (e.g. the inbox reply path) — still resolve the stored
    // securities flag server-side rather than trusting the caller.
    try {
      const { data: conv } = await db
        .from('comm_conversations')
        .select('is_security')
        .eq('id', conversationId)
        .maybeSingle()
      convIsSecurity = conv?.is_security === true
    } catch {
      convIsSecurity = false
    }
  }

  // ── Email subject, resolved at the ONE choke point ──────────────────────────
  // comm_templates has no `subject` column: an email body carries its subject on a leading
  // "Subject:" line, which the marketing shell renders as the card H1 (template-subject.ts).
  // Callers that already parsed it win; every caller that did NOT (the console/test sends and
  // the campaign-asset picker, which had no way to reach the body's header) previously shipped
  // an envelope with no subject at all — the recipient saw "(No Subject)" on a mail whose H1
  // read correctly. Resolving it here means no send path can regress that again.
  const resolvedSubject =
    ctx.channel === 'email' ? ctx.subject?.trim() || parseSubjectFromBody(ctx.body) : ctx.subject

  // Personalize merge tokens (safe substitution; the gate still checks the result).
  // On email the body is HTML → HTML-escape recipient-controlled merge VALUES so a
  // name/city containing markup can't inject into the delivered email or the stored
  // body the operator console renders (stored-XSS defense, §13.8). SMS substitutes raw.
  // Email deliverability (CAN-SPAM): inject the per-recipient unsubscribe URL so the
  // shared footer's {{unsubscribe_url}} token resolves to a working, recipient-specific
  // opt-out link (the enforced DNC-store suppression endpoint). SMS carries the opt-out
  // via the appended STOP footer instead, so this is email-only.
  // Advisor + agency identity and the absolute scheduling link are single-FSA constants,
  // injected here as CALLER-OVERRIDABLE defaults (§17): every campaign/booking send inherits
  // correct identity + a working booking link, while a caller that supplies its own value wins.
  // The per-recipient unsubscribe_url is FORCED for email (security-critical, never overridable).
  // Resolve the recipient's AGENT OF RECORD once (their Farmers agency owner) from the represented
  // agency on the spine — reused for both the body variables and the identity disclosure below.
  const agencyForOwner = ctx.ownership?.representedAgencyId ?? ctx.delegation?.agencyId ?? convAgencyId ?? null
  const agentOfRecord: AgentOfRecord | null = await resolveAgentOfRecord(agencyForOwner)
  // Load the recipient's policy (when a policyId is supplied, e.g. the life-conversion campaign)
  // so the policy/conversion variables resolve from the spine. Fails soft to null → those
  // variables then fail closed at the gate if referenced (never a blank/guessed value).
  const policySource = await resolvePolicySource(ctx.policyId)

  // Build the per-recipient merge context through the ONE centralized resolver (variables.ts):
  // advisor + agency identity, scheduling/reply-to/sender, the resolved agent of record, the
  // recipient's name, and the policy/conversion facts. A caller-supplied value still wins; the
  // per-recipient unsubscribe_url is FORCED for email (never overridable, §13.8).
  const recipientCtx: RecipientContext = {
    ...buildRecipientContext({
      contact: {
        full_name: ctx.recipientContext?.full_name ?? null,
        first_name: ctx.recipientContext?.first_name ?? null,
        last_name: ctx.recipientContext?.last_name ?? null,
      },
      agentOfRecord,
      policy: policySource,
    }),
    ...(ctx.recipientContext ?? {}),
    ...(ctx.channel === 'email' ? { unsubscribe_url: emailUnsubscribeUrl(to) } : {}),
  }
  // Fail-closed personalization (§13): any BLOCKING-tier merge token the template references but
  // the context cannot resolve (missing identity, a relative/absent opt-out or manage link, a
  // blank appointment time) hard-blocks the send at the gate — never shipped with an empty
  // placeholder. Checked over BOTH the HTML body and the plaintext part.
  const unresolvedTokens = [
    ...new Set([
      ...unresolvedBlockingTokens(ctx.body, recipientCtx),
      ...(ctx.bodyText ? unresolvedBlockingTokens(ctx.bodyText, recipientCtx) : []),
    ]),
  ]
  const personalized = personalize(ctx.body, recipientCtx, { escapeHtml: ctx.channel === 'email' })
  // Slice 9B — the stored plaintext part, personalized the same way (email multipart).
  // Plaintext is never HTML, so values are substituted verbatim (no escaping).
  const personalizedText = ctx.bodyText ? personalize(ctx.bodyText, recipientCtx) : undefined

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
    // The platform disclosure names the CLIENT'S OWN agent of record (resolved above), never a
    // guessed one. A caller-supplied name wins; if none is resolvable, agency_owner stays empty and
    // the engine degrades to the approved generic "your Farmers agent" (§4.3, ADR-016). Sender
    // defaults to the single FSA.
    const suppliedOwnerName = ctx.identity.vars?.agency_owner?.full_name?.trim() || ''
    const agentOfRecordName = suppliedOwnerName || agentOfRecord?.full_name || null
    const identityWithOwner: IdentityContext = {
      ...ctx.identity,
      vars: {
        ...ctx.identity.vars,
        sender: {
          full_name: ctx.identity.vars?.sender?.full_name?.trim() || BUSINESS.agent,
          first_name: ctx.identity.vars?.sender?.first_name ?? null,
        },
        agency_owner: {
          full_name: agentOfRecordName,
          first_name: ctx.identity.vars?.agency_owner?.first_name ?? null,
        },
      },
    }
    const idr = await resolveIdentityDisclosure({
      channel: ctx.channel,
      conversationId,
      ctx: identityWithOwner,
    })
    // identity_full_intro records what the message ACTUALLY carried, not merely what was
    // required: when no approved config exists, idr.disclosure is null and no full intro
    // is sent — the (unmet) requirement is still captured in identityReason for audit.
    // An introduction carried by the approved authored body counts (satisfiedByBody), so the
    // thread is stamped as introduced and later touches do not re-introduce.
    identityFullIntro = idr.disclosure != null || idr.satisfiedByBody
    identityFirstTouch = idr.isFirstChannelTouch
    identityVersion = idr.disclosure != null ? idr.version : null
    identityReason = idr.reason
    if (idr.disclosure) {
      identityBody = prependIdentityDisclosure(idr.disclosure, personalized)
      if (personalizedText) identityText = prependIdentityDisclosure(idr.disclosure, personalizedText)
    }
  }

  // FAIL CLOSED (audit finding P1-A — the email sibling of F-2): the AUTHORED body
  // (post-personalization, post-identity-disclosure, PRE branded-shell wrap) must carry real
  // content. The gate's `message_content` backstop validates req.body, which for EMAIL is the
  // already-wrapped branded shell (Farmers logo + CAN-SPAM footer) and is therefore NEVER empty
  // — even when the template body resolved to ''. So an empty/whitespace email template would
  // ship as a signature-only "near-empty" email on the broadcast/drip/legacy paths (the campaign
  // ticks guard upstream; those three paths do not). Catch it HERE, at the single send
  // choke-point, so every caller inherits the guard — the email analog of the 67-client blank-SMS
  // incident. SMS empties are already blocked at the gate; this is defense in depth for both
  // channels and runs BEFORE the wrap so the shell can never mask an empty body.
  if (identityBody.trim() === '') {
    const reason = `Empty ${ctx.channel} body — nothing to send; withheld before branded-shell wrap.`
    try {
      await writeAudit({
        actor: ctx.actor,
        action: 'comms.blocked',
        entity: ctx.entity?.type ?? (conversationId ? 'conversation' : 'message'),
        entityId: ctx.entity?.id ?? conversationId ?? null,
        diff: {
          channel: ctx.channel,
          to,
          blockedStep: 'message_content',
          reason,
          sourceCampaignKey: ctx.sourceCampaignKey ?? null,
          campaignId: ctx.campaignId ?? null,
          templateId: ctx.templateId ?? null,
        },
      })
    } catch {
      /* best-effort audit; the return below still withholds the send */
    }
    return {
      sent: false,
      blocked: true,
      gate: { allowed: false, escalate: true, reason },
      conversationId: conversationId ?? undefined,
      reason,
    }
  }

  // ── Policy context, NOT policy decisions ───────────────────────────────────
  // This layer used to resolve consent, DNC, suppression, template approval, quiet hours
  // and business hours itself, then hand the answers to the gate. It no longer does. Those
  // reads moved to the DISPATCH CHOKEPOINT (lib/messaging.ts via dispatch-policy.ts),
  // where they run for every send — including the nine paths that never called this
  // function. What remains here is message PREPARATION: threading, personalization,
  // identity disclosure, the message-of-record, the branded shell and tracking.
  //
  // Only the caller-owned findings are assembled below. Consent is deliberately absent:
  // `consent_at_send` is patched after dispatch from the SAME read the decision was made
  // on, so the record can never claim a consent state the gate did not actually see.
  // On-behalf-of authority (Slice 1). Resolved FRESH here (never from an enrollment
  // snapshot) because it is caller-owned context — which delegation authorizes THIS send —
  // rather than a recipient-state read.
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

  // Data confidence (Slice 6, §13): a message making SPECIFIC claims on unverified data is
  // excluded. Caller-owned (the caller declares which claims the copy makes).
  let dataConfidenceOk: boolean | undefined
  let dataConfidenceReason: string | undefined
  let dataConfidenceUnverified: string[] = []
  if (ctx.dataConfidence) {
    const dc = evaluateDataConfidence(ctx.dataConfidence)
    dataConfidenceOk = dc.allowed
    dataConfidenceReason = dc.reason
    dataConfidenceUnverified = dc.unverified
  }

  // How gate step 4 is satisfied for this send, declared explicitly so the chokepoint does
  // not have to infer it from a combination of flags.
  const templateKind: TemplateKind = ctx.templateId
    ? 'stored'
    : ctx.humanAuthored === true
      ? 'human'
      : ctx.aiGenerated === true
        ? 'ai_policy'
        : ctx.systemTransactional === true
          ? 'system_transactional'
          : 'stored'

  // Pre-insert the message row (queued) so email tracking can reference its id and
  // so a blocked send is still visible in the timeline. The final status/provider
  // id are patched after dispatch. This row IS the message-of-record (§13.9): the
  // body snapshot, consent-at-send, and delivery status live here — so a failed
  // write FAILS THE SEND (audited + escalated below), never a silent skip. A
  // silently-swallowed FK failure here once cost every campaign send its record
  // (docs/audit/outbound-campaigns-2026-08-07.md).
  let messageId: string | undefined
  let messageOfRecordError: string | undefined
  try {
    const { data, error } = await db
      .from('comm_messages')
      .insert({
        channel: ctx.channel,
        direction: 'outbound',
        recipient: to,
        subject: resolvedSubject ?? null,
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
        // Patched post-dispatch from the chokepoint's resolution, so the record can never
        // claim a consent state the gate did not actually evaluate.
        consent_at_send: null,
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
        // Communications Command Console — send provenance (spec §3.1). Descriptive only;
        // does not affect the gate. is_test excludes the row from production analytics.
        source_kind: ctx.sourceKind ?? 'blank',
        source_campaign_key: ctx.sourceCampaignKey ?? null,
        source_asset_id: ctx.sourceAssetId ?? null,
        source_asset_table: ctx.sourceAssetTable ?? null,
        is_test: ctx.isTest === true,
        queued_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle()
    // supabase-js does NOT throw on a DB constraint failure — it returns the error here. The
    // message-of-record is the §13.9 record of every send; a failed insert must be OBSERVABLE, not
    // silently swallowed. (Audit finding F-1: World-2 campaign sends fed a per-campaign-table id
    // into campaign_id, whose FK targets comm_campaigns, so every insert failed into this ignored
    // `error` and no message-of-record was ever written — invisibly. Never let this class of
    // failure hide again.)
    if (error) {
      messageOfRecordError = error.message
      console.error('[comms] message-of-record insert failed:', error.message, {
        channel: ctx.channel,
        campaignId: ctx.campaignId ?? null,
        entity: ctx.entity ?? null,
        conversationId,
      })
    }
    messageId = data?.id
  } catch (err) {
    // A genuine throw (network/client) is also logged — never a bare silent swallow.
    messageOfRecordError = err instanceof Error ? err.message : String(err)
    console.error('[comms] message-of-record insert threw:', messageOfRecordError)
  }

  // FAIL CLOSED (audit finding F-1): the §13.9 message-of-record is a REQUIRED artifact of
  // every send. A provider send must NEVER silently succeed while its message-of-record insert
  // failed. If the pre-insert errored or returned no id, we withhold the send entirely — the
  // dispatcher/provider is never reached — and record the withholding observably. This closes
  // the exact class of failure behind F-1 (World-2 campaign ids violated the campaign_id FK, the
  // insert failed, and the send went out anyway with no record). A transient DB fault now defers
  // the send (retried next cycle) instead of shipping an untraceable message.
  if (!messageId) {
    const reason = `Message-of-record could not be created — send withheld${messageOfRecordError ? ` (${messageOfRecordError})` : ''}.`
    try {
      await writeAudit({
        actor: ctx.actor,
        action: 'comms.blocked',
        entity: ctx.entity?.type ?? (conversationId ? 'conversation' : 'message'),
        entityId: ctx.entity?.id ?? conversationId ?? null,
        diff: {
          channel: ctx.channel,
          to,
          blockedStep: 'message_of_record',
          reason: messageOfRecordError ?? 'message-of-record insert returned no id',
          sourceCampaignKey: ctx.sourceCampaignKey ?? null,
          campaignId: ctx.campaignId ?? null,
          templateId: ctx.templateId ?? null,
        },
      })
    } catch {
      /* best-effort — the console.error above is the durable signal if audit is also down */
    }
    // Escalate to the human-FSA queue (§16.6): a withheld send is a recoverable failure that
    // needs operator attention (fix the record path, then the deferred touch retries).
    try {
      await db.from('agent_actions').insert({
        kind: 'escalation',
        actor: ctx.actor,
        outcome: 'escalated',
        target_type: ctx.entity?.type ?? 'conversation',
        target_id: ctx.entity?.id ?? convHouseholdId ?? conversationId,
        reason: 'message_of_record_write_failed',
        blocked_step: 'message_of_record',
        note: reason,
      })
    } catch {
      /* best-effort escalation; the audit row above is the durable record */
    }
    return {
      sent: false,
      blocked: true,
      gate: { allowed: false, escalate: true, reason },
      conversationId: conversationId ?? undefined,
      reason,
    }
  }

  // Premium branding at the single send choke-point (DESIGN.md §31): wrap the personalized
  // email body in the shared branded shell (Farmers logo header + CAN-SPAM marketing footer
  // with this recipient's resolved unsubscribe link). A body that is ALREADY a full HTML
  // document (the react-email templates in src/emails/*, ADR-025) is passed through
  // untouched — never double-wrapped. This upgrades EVERY campaign email (library blueprints,
  // seed-migration templates, FSA-authored, AI) to premium HTML regardless of its source,
  // instead of only the react-email-authored subset. SMS is unaffected.
  const emailReady =
    ctx.channel === 'email'
      ? wrapMarketingEmailBody(identityBody, { preheader: resolvedSubject, unsubscribeUrl: recipientCtx.unsubscribe_url })
      : identityBody

  // Instrument outbound email with open/click tracking (needs the message id). Runs AFTER
  // the wrap so the tracking pixel lands inside <body> and the branded CTA links are
  // click-tracked. The body already includes any auto-prepended identity disclosure.
  const sendBody =
    ctx.channel === 'email' && messageId ? instrumentEmailHtml(emailReady, messageId) : emailReady

  const req: DispatchRequest = {
    channel: ctx.channel,
    to,
    subject: resolvedSubject,
    body: sendBody,
    correlationId: messageId,
    bodyText: ctx.channel === 'email' ? identityText : undefined,
    messageClass: streamForPurpose(ctx.purpose),
    actor: ctx.actor,
    entity: ctx.entity ?? (conversationId ? { type: 'conversation', id: conversationId } : undefined),
    templateKind,
    memberId: convMemberId,
    householdId: convHouseholdId,
    agencyId: convAgencyId,
    conversationId,
    campaignKey: ctx.sourceCampaignKey ?? (ctx.campaignId ?? null),
    workerKey: ctx.aiGenerated === true ? (ctx.aiAuthorAgentKey ?? 'conversation') : null,
    utcOffsetHours: ctx.utcOffsetHours,
    timeZone: ctx.timeZone,
    policy: {
      purpose: ctx.purpose,
      templateId: ctx.templateId ?? null,
      aiGenerated: ctx.aiGenerated === true,
      aiMessageClass: ctx.aiMessageClass,
      aiAuthorAgentKey: ctx.aiAuthorAgentKey,
      identityDisclosureSatisfied: !ctx.identity ? true : identityFirstTouch ? identityFullIntro === true : true,
      durableConsentGranted: ctx.durableConsentGranted,
      consentWaived: ctx.consentWaived,
      suppressible: ctx.suppressible,
      isTest: ctx.isTest,
      isConversationReply: ctx.isConversationReply,
      activeCampaignPurpose: ctx.activeCampaignPurpose ?? null,
      recipientZip: ctx.recipientZip ?? null,
      recipientPhone: ctx.recipientPhone ?? null,
    },
    gate: {
      ownershipResolved: ctx.ownershipResolved,
      ownershipConflict: ctx.ownershipConflict,
      // Firewall (§4.1): caller flag OR the server-resolved conversation/household flag.
      // The chokepoint ORs it again with its own read — it can only get more restrictive.
      isSecurity: ctx.isSecurity === true || convIsSecurity,
      delegationValid,
      delegationReason,
      personalizationResolved: unresolvedTokens.length === 0,
      personalizationReason: unresolvedTokens.length
        ? `Unresolved required merge tokens: ${unresolvedTokens.join(', ')}`
        : undefined,
      dataConfidenceOk,
      dataConfidenceReason,
      // These are resolved at the chokepoint; the values here are inert placeholders that
      // satisfy the GateInput shape and are NOT forwarded (see dispatcher.ts).
      hasConsent: false,
      recipientLocalHour: 12,
      onDNC: false,
      usesApprovedTemplateOrPolicy: false,
    },
  }

  // §11/§12 AI authority is evaluated at the CHOKEPOINT (dispatch-policy.ts), alongside the
  // consent and template-approval reads it depends on — see the note above. It surfaces here
  // as gate step `ai_authority`, and the draft-recording below is this layer's response to
  // that verdict. Evaluating it here as well would mean two layers reading the same facts
  // separately, which is exactly the disagreement this refactor removes.

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
          // Persist the EXACT transmitted body so the audit record includes the SMS
          // opt-out footer the dispatcher appended at send (§13.9 audit fidelity).
          ...(result.sent && result.sentBody ? { body: result.sentBody } : {}),
          // The consent the chokepoint actually resolved, and the timezone the quiet-hours
          // decision was made in — recorded so a send is reconstructible after the fact.
          ...(result.resolved ? { consent_at_send: result.resolved.consent } : {}),
          ...(result.timezone
            ? {
                resolved_timezone: result.timezone.zone,
                // Method/input are recorded ONLY for a map resolution (a real NPA or ZIP3).
                // A caller-supplied zone and the legacy flag-off default record the zone
                // with a null method — mig 123's contract for "not evidence-resolved".
                ...(result.timezone.resolution.resolved &&
                !['caller', 'caller_offset', 'legacy_default'].includes(result.timezone.resolution.input)
                  ? {
                      tz_resolution_method: result.timezone.resolution.method,
                      tz_resolution_input: result.timezone.resolution.input,
                    }
                  : { tz_resolution_method: null, tz_resolution_input: null }),
              }
            : {}),
          error: result.error ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
    } catch {
      /* best-effort */
    }
  }

  // §11/§12 hold → record the AI draft for the licensed FSA (the chokepoint already blocked
  // the send and escalated it). This is the recovery path, not the decision.
  if (!result.sent && result.gate.blockedStep === 'ai_authority') {
    try {
      await db.from('agent_actions').insert({
        kind: 'ai_draft',
        actor: ctx.actor,
        outcome: 'drafted',
        target_type: ctx.entity?.type ?? 'conversation',
        target_id: ctx.entity?.id ?? convHouseholdId ?? conversationId,
        reason: result.gate.reason ?? 'ai_authority',
        note: `ai message class "${ctx.aiMessageClass || 'unclassified'}" not auto-sent (§11/§12)`,
        drafted_content: identityBody,
      })
    } catch {
      /* best-effort — the message row already records the hold */
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
