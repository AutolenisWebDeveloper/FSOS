// src/lib/comms/identity.ts
// Slice 2 — First-contact identity disclosure engine (DECISION CORE + RENDERER, PURE).
//
// The PLATFORM is responsible for inserting the approved identity disclosure — a
// campaign author never has to remember it (master build instruction §8). This module
// is the pure decision + rendering, so it is unit-testable offline (tests/comms-
// identity.test.mjs) exactly like gate.ts / delegation.ts. The DB-backed caller
// (send.ts) supplies the per-channel conversation state + `now`, then prepends the
// rendered disclosure when a full introduction is required.
//
// Two invariants it upholds:
//   • Disclosure is PER CHANNEL: a first email never satisfies the first-SMS
//     requirement (channelAlreadyTouched is a per-channel signal).
//   • It NEVER fabricates the Farmers entity wording — the role/entity label and the
//     templates come from editable, approved config (§4.3), not a hard-coded string.
//
// The rendered wording never implies the actual sender is the agency owner / the
// customer's existing agent, or that a product was purchased — the approved templates
// (config) frame the sender as acting ON BEHALF OF the represented agent (§8).

export type Channel = 'sms' | 'email'
export type DisclosureMode = 'full' | 'abbreviated'

export interface IdentityFlags {
  /** First message ever on THIS channel to this contact. */
  isFirstChannelTouch: boolean
  /** A full introduction is being included on this send. */
  fullIntro: boolean
  /** An identity-refresh condition (not just first-touch) forced the full intro. */
  refreshRequired: boolean
}

export interface IdentityInput {
  channel: Channel
  /** ISO timestamp of the last full disclosure on THIS channel/thread (null = never). */
  priorDisclosedAt: string | null
  /** ISO "now" (supplied by the caller — never read the clock in a pure fn). */
  now: string
  /** Configured inactivity window; a thread that has gone quiet for longer re-introduces. */
  inactivityDays: number
  /**
   * ISO timestamp of the most recent message on this thread in EITHER direction (null = none).
   * This — not the age of the disclosure — is what the inactivity window measures. Ageing off
   * `priorDisclosedAt` re-introduced the FSA in the middle of a live campaign purely because
   * the campaign had been running longer than the window, which is the opposite of the rule's
   * intent: an introduction is refreshed when a RELATIONSHIP has gone cold, not when a
   * conversation has simply been going on for a while.
   */
  lastContactAt: string | null
  /** Has THIS channel been used with this contact before? (per-channel, not global). */
  channelAlreadyTouched: boolean
  /** First message of a new campaign. */
  newCampaign: boolean
  /** The communication purpose differs from the last disclosed one. */
  purposeChanged: boolean
  /** A different actual sender than the one last disclosed. */
  senderChanged: boolean
  /** Agency-owner or contact-owner reassignment since the last disclosure. */
  reassignment: boolean
  /** The contact explicitly asked who is contacting them. */
  contactAskedWhoIsThis: boolean
  /** FSOS can confirm the prior disclosure remains contextually clear. */
  priorDisclosureConfirmable: boolean
}

export interface IdentityDecision {
  fullIntroRequired: boolean
  mode: DisclosureMode
  reason: string
  flags: IdentityFlags
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO)
  const to = Date.parse(toISO)
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.POSITIVE_INFINITY
  return (to - from) / (1000 * 60 * 60 * 24)
}

/**
 * Decide whether a FULL introduction is required for this send (§8). First matching
 * trigger wins (its reason is returned). When no trigger fires, the approved
 * abbreviated identity form is allowed. Full-intro triggers other than first-touch are
 * "refresh" conditions.
 */
export function evaluateIdentityDisclosure(input: IdentityInput): IdentityDecision {
  const isFirstChannelTouch = !input.channelAlreadyTouched || !input.priorDisclosedAt

  const full = (reason: string, refresh: boolean): IdentityDecision => ({
    fullIntroRequired: true,
    mode: 'full',
    reason,
    flags: { isFirstChannelTouch, fullIntro: true, refreshRequired: refresh },
  })

  // First-touch (incl. a new channel) — the primary trigger.
  if (isFirstChannelTouch) return full('First-ever contact on this channel — full introduction required.', false)

  // Refresh conditions (order chosen so the most specific/important reason surfaces).
  if (input.contactAskedWhoIsThis) return full('The contact asked who is contacting them.', true)
  if (input.senderChanged) return full('A different sender than last disclosed — re-introduce.', true)
  if (input.reassignment) return full('Agency-owner / contact-owner reassignment since last disclosure.', true)
  if (input.purposeChanged) return full('New communication purpose — re-introduce.', true)
  if (input.newCampaign) return full('First message in a new campaign — full introduction required.', true)
  if (!input.priorDisclosureConfirmable) {
    return full('Prior disclosure cannot be confirmed as contextually clear — re-introduce.', true)
  }
  // Measured from the thread's last message when we know it, falling back to the disclosure
  // itself when the thread has no recorded traffic (priorDisclosedAt is non-null here — a null
  // one makes isFirstChannelTouch true above — so the fallback is always defined).
  const lastTouch = input.lastContactAt ?? input.priorDisclosedAt
  if (lastTouch && daysBetween(lastTouch, input.now) >= input.inactivityDays) {
    return full('The thread has been inactive longer than the configured window — re-introduce.', true)
  }

  return {
    fullIntroRequired: false,
    mode: 'abbreviated',
    reason: 'Identity already established on this channel/thread — abbreviated form allowed.',
    flags: { isFirstChannelTouch: false, fullIntro: false, refreshRequired: false },
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────
export interface IdentityConfig {
  /** The approved, editable Farmers entity/role label (§4.3 — never hard-coded). */
  fsaRoleLabel: string
  fullTemplate: string
  abbreviatedTemplate: string
}

export interface IdentityVars {
  sender: { first_name?: string | null; full_name?: string | null }
  agency_owner: { first_name?: string | null; full_name?: string | null }
  communication?: { reason?: string | null }
}

/**
 * The one way FSOS refers to the recipient's agent of record in client-facing copy: "your
 * Farmers agent, Jane Smith" when the name is confidently on file, and the approved generic
 * "your Farmers agent" when it is not — never a guessed name (§4.3) and never the doubled
 * "your Farmers agent, your Farmers agent".
 *
 * Lives here (rather than in variables.ts) because identity.ts is the pure, dependency-free
 * module; variables.ts imports it so the {{agent_of_record_reference}} merge token and the
 * platform disclosure's {{agency_owner.reference}} can never drift apart (CLAUDE.md §6).
 */
export function agentOfRecordReference(fullName?: string | null): string {
  const name = String(fullName ?? '').trim()
  return name ? `your Farmers agent, ${name}` : 'your Farmers agent'
}

/**
 * Render the approved disclosure by filling the CONFIG templates. Only the registered
 * identity tokens are substituted (no arbitrary expressions). Unknown/empty tokens
 * resolve to a safe neutral so a raw {{token}} never leaks to a contact.
 */
export function renderIdentityDisclosure(config: IdentityConfig, vars: IdentityVars, mode: DisclosureMode): string {
  const ownerName = vars.agency_owner.full_name?.trim() || ''
  const values: Record<string, string> = {
    'sender.first_name': vars.sender.first_name?.trim() || vars.sender.full_name?.trim()?.split(/\s+/)[0] || 'your Financial Services Agent',
    'sender.full_name': vars.sender.full_name?.trim() || 'your Financial Services Agent',
    'agency_owner.first_name': vars.agency_owner.first_name?.trim() || ownerName.split(/\s+/)[0] || 'your Farmers agent',
    'agency_owner.full_name': ownerName || 'your Farmers agent',
    'agency_owner.reference': agentOfRecordReference(ownerName),
    'communication.reason': vars.communication?.reason?.trim() || 'your coverage',
    fsa_role_label: config.fsaRoleLabel,
  }
  const template = mode === 'full' ? config.fullTemplate : config.abbreviatedTemplate
  return template.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_m, token: string) => {
    const key = token.toLowerCase()
    return key in values ? values[key] : ''
  })
}

/**
 * Compose the disclosure and the message body. Idempotent: if the body already contains the
 * disclosure (e.g. a re-render/retry), it is not duplicated.
 *
 * The disclosure is inserted as the message's FIRST PARAGRAPH, which is not always the first
 * LINE. A campaign email body opens with its own routing headers — a "Subject:" line (rendered
 * as the card H1) and a "Preview:" line (the inbox preheader) — and then a greeting. Blindly
 * prepending ahead of those headers pushed them out of the leading-header window that
 * email-shell.ts / template-subject.ts parse, so the email lost its H1 and preheader and
 * displayed a literal "Subject: …" line as body copy. Skipping past the headers (and past a
 * short greeting line, so the disclosure reads as the opening sentence rather than interrupting
 * "Hi Sarah,") keeps the disclosure equally prominent while leaving the headers intact.
 *
 * SMS bodies have neither headers nor a standalone greeting line, so they are unaffected.
 */
export function prependIdentityDisclosure(disclosure: string, body: string): string {
  const d = disclosure.trim()
  if (!d) return body
  if (body.includes(d)) return body

  const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n')
  let i = 0
  // Skip the leading Subject:/Preview: header lines (and any blank lines among them).
  for (; i < lines.length; i++) {
    if (/^\s*$/.test(lines[i])) continue
    if (/^\s*(subject|preview):/i.test(lines[i])) continue
    break
  }
  // Skip a standalone greeting line ("Hi Sarah," / "Hello there,") so the disclosure opens the
  // body rather than splitting the salutation from it.
  if (i < lines.length && /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening))\b.{0,60},\s*$/i.test(lines[i])) {
    i++
  }
  if (i === 0) return `${d}\n\n${body}`

  const head = lines.slice(0, i).join('\n').replace(/\s+$/, '')
  const rest = lines.slice(i).join('\n').replace(/^\n+/, '')
  return rest ? `${head}\n\n${d}\n\n${rest}` : `${head}\n\n${d}`
}
