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
  /** Configured inactivity window; a disclosure older than this is stale → refresh. */
  inactivityDays: number
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
  // priorDisclosedAt is non-null here (a null one makes isFirstChannelTouch true above),
  // but guard explicitly so the type is narrowed and the intent is clear.
  if (input.priorDisclosedAt && daysBetween(input.priorDisclosedAt, input.now) >= input.inactivityDays) {
    return full('Prior disclosure is older than the configured inactivity window — re-introduce.', true)
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
 * Render the approved disclosure by filling the CONFIG templates. Only the registered
 * identity tokens are substituted (no arbitrary expressions). Unknown/empty tokens
 * resolve to a safe neutral so a raw {{token}} never leaks to a contact.
 */
export function renderIdentityDisclosure(config: IdentityConfig, vars: IdentityVars, mode: DisclosureMode): string {
  const values: Record<string, string> = {
    'sender.first_name': vars.sender.first_name?.trim() || vars.sender.full_name?.trim()?.split(/\s+/)[0] || 'your Financial Services Agent',
    'sender.full_name': vars.sender.full_name?.trim() || 'your Financial Services Agent',
    'agency_owner.first_name': vars.agency_owner.first_name?.trim() || vars.agency_owner.full_name?.trim()?.split(/\s+/)[0] || 'your Farmers agent',
    'agency_owner.full_name': vars.agency_owner.full_name?.trim() || 'your Farmers agent',
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
 * Compose the disclosure and the message body. Idempotent: if the body already opens
 * with the disclosure (e.g. a re-render/retry), it is not duplicated.
 */
export function prependIdentityDisclosure(disclosure: string, body: string): string {
  const d = disclosure.trim()
  if (!d) return body
  if (body.trimStart().startsWith(d)) return body
  return `${d}\n\n${body}`
}
