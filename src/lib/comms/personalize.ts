// src/lib/comms/personalize.ts
// Merge-token personalization for templates and campaigns. Tokens look like {{first_name}}
// and are replaced from a recipient context.
//
// Two token tiers (fail-closed contract, ADR-020/§13):
//   • COSMETIC tokens (first_name, last_name, full_name, city, greeting) keep a SAFE neutral
//     default — a missing one degrades gracefully and never blocks a send.
//   • BLOCKING tokens (advisor + agency identity, the unsubscribe/scheduling links, and the
//     booking specifics: appointment_time, meeting_details, reschedule_url, cancel_url) MUST
//     resolve from context. A referenced-but-unresolved blocking token is reported by
//     unresolvedBlockingTokens() so the send path HARD-BLOCKS + escalates (gate step
//     `personalization`). The renderer NEVER emits a raw "{{token}}" and, for a blocking
//     token, never silently ships a misleading empty value to a contact — the send is stopped.
//
// This substitutes EVERY key present in the passed context, not just a fixed allowlist — so a
// caller (e.g. the booking notify path) that supplies appointment_time / meeting_details /
// reschedule_url / cancel_url has those rendered into the delivered body rather than blanked.
// (Regression fixed: those four were dropped at substitution time, shipping empty "When:" lines
// and broken "Reschedule: — or cancel:" sentences in confirmation/reminder emails.)
//
// This is content substitution only — it CANNOT introduce recommendation language (the gate
// still runs containsRecommendationLanguage on the final body), so personalization can never
// smuggle a red-line message past the guardrail.
//
// On the EMAIL channel the body is HTML, so recipient-controlled merge values are HTML-escaped
// before substitution (opts.escapeHtml) — a name/city containing markup can never inject into
// the delivered email or the stored comm_messages.body the operator console later renders
// (stored-XSS defense, §13.8). SMS + plaintext parts substitute verbatim.

import {
  canonicalVarKey,
  REGISTRY_BLOCKING_KEYS,
  REGISTRY_URL_KEYS,
  REGISTRY_COSMETIC_DEFAULTS,
} from './variables'

export interface RecipientContext {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  city?: string | null
  /** Advisor identity — the single FSA (site.ts BUSINESS). Blocking-tier. */
  fsa_name?: string | null
  advisor_phone?: string | null
  advisor_email?: string | null
  /** Agency identity. Blocking-tier. */
  agency_name?: string | null
  /**
   * Per-recipient unsubscribe URL (CAN-SPAM). Injected by the email send path (sendThroughGate)
   * so every marketing email carries a working, recipient-specific opt-out link. Blocking-tier:
   * a relative or missing value stops the send rather than shipping a broken/relative opt-out.
   */
  unsubscribe_url?: string | null
  /** Client-facing booking URL (absolute). Blocking-tier. */
  scheduling_link?: string | null
  /**
   * Booking specifics, grounded per-send by the booking notify path. Blocking-tier: a booking
   * email must carry its real time / how-to-attend / manage links, never an empty placeholder.
   */
  appointment_time?: string | null
  meeting_details?: string | null
  reschedule_url?: string | null
  cancel_url?: string | null
  /** Any additional green-zone merge token a caller supplies is substituted verbatim. */
  [key: string]: string | null | undefined
}

/**
 * COSMETIC tokens — keep a safe neutral default and never block a send. Merged from the central
 * variable registry (variables.ts) with the two send-local cosmetic tokens (city, greeting) that
 * are not part of the canonical set.
 */
const COSMETIC_DEFAULTS: Record<string, string> = {
  ...REGISTRY_COSMETIC_DEFAULTS,
  city: 'your area',
  greeting: 'Hello',
}

/**
 * BLOCKING-tier tokens — factual/identity values that MUST resolve. If a template references one
 * and the context does not resolve it (missing/empty, or — for a URL token — not absolute), the
 * send is hard-blocked + escalated (never shipped with a raw token or blank). Merged from the
 * central registry (variables.ts) with the send-injected/booking tokens that live only in the
 * send path (the opt-out link + appointment specifics).
 */
export const BLOCKING_TOKENS: ReadonlySet<string> = new Set([
  ...REGISTRY_BLOCKING_KEYS,
  'fsa_name',
  'unsubscribe_url',
  'appointment_time',
  'meeting_details',
  'reschedule_url',
  'cancel_url',
])

/** Blocking tokens that are URLs — must resolve to an ABSOLUTE http(s) link (never relative). */
const URL_TOKENS: ReadonlySet<string> = new Set([
  ...REGISTRY_URL_KEYS,
  'unsubscribe_url',
  'reschedule_url',
  'cancel_url',
])

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi

function firstNameOf(ctx: RecipientContext): string {
  if (ctx.first_name) return String(ctx.first_name).trim()
  const full = String(ctx.full_name || '').trim()
  return full ? full.split(/\s+/)[0] : ''
}

/** Escape a merge VALUE for safe interpolation into an HTML body (not the template). */
function escapeHtmlValue(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** True iff `v` is an absolute http(s) URL (the only acceptable link value for a URL token). */
function isAbsoluteUrl(v: string): boolean {
  return /^https?:\/\//i.test(v)
}

/** The raw (pre-escape) substitution value for one token — cosmetic default or context value. */
function rawValueFor(token: string, ctx: RecipientContext): string {
  if (token === 'first_name') return firstNameOf(ctx) || COSMETIC_DEFAULTS.first_name
  if (token === 'full_name') {
    const full = String(ctx.full_name || '').trim()
    return full || firstNameOf(ctx) || COSMETIC_DEFAULTS.full_name
  }
  const provided = ctx[token]
  const val = typeof provided === 'string' ? provided.trim() : ''
  if (val) return val
  // Missing: a cosmetic token degrades to its neutral default; a blocking/unknown token renders
  // EMPTY here (never a raw "{{token}}"). The send path independently blocks a referenced
  // blocking token via unresolvedBlockingTokens(), so an empty blocking value is never delivered.
  if (Object.prototype.hasOwnProperty.call(COSMETIC_DEFAULTS, token)) return COSMETIC_DEFAULTS[token]
  return ''
}

export interface PersonalizeOptions {
  /** HTML-escape each substituted value (set for the email HTML channel; never for SMS/plaintext). */
  escapeHtml?: boolean
}

/** Replace every {{token}} in `body` using the recipient context (+ cosmetic defaults). Tokens
 *  resolve case/-separator-insensitively via the central registry ({{FirstName}} == {{first_name}}). */
export function personalize(body: string, ctx: RecipientContext, opts: PersonalizeOptions = {}): string {
  return body.replace(TOKEN_RE, (_m, token: string) => {
    const raw = rawValueFor(canonicalVarKey(token), ctx)
    return opts.escapeHtml ? escapeHtmlValue(raw) : raw
  })
}

/**
 * The tokens a body references that the context cannot resolve — the fail-closed signal the send
 * path turns into gate step `personalization` (hard block + escalate). A token is unresolved when
 * it is missing/empty, or — for a URL token — not an absolute http(s) link.
 *
 * Classification is fail-closed by DEFAULT, which is the important property:
 *   • COSMETIC tokens are never reported — they degrade to a safe neutral default by design.
 *   • BLOCKING tokens are reported when they do not resolve.
 *   • UNREGISTERED tokens are ALSO reported when they do not resolve. `personalize()` renders an
 *     unknown token as an empty string exactly like a blocking one, so a typo'd or never-supplied
 *     token silently ships a blank where a factual value belongs ("your meeting on  at ..."). This
 *     previously `continue`d out of the loop and was invisible to the gate — a blocking token
 *     failed SAFE while an unknown token failed SILENT. Both now fail safe.
 *
 * The RecipientContext index signature (a caller supplying its own green-zone token) still works:
 * a supplied token resolves to a non-empty value and is therefore never reported. Only tokens that
 * resolve to nothing are blocked.
 */
export function unresolvedBlockingTokens(body: string, ctx: RecipientContext): string[] {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const token of tokensIn(body)) {
    // tokensIn already returns CANONICAL keys, so classification + ctx lookup are keyed
    // consistently regardless of how the author spelled the token in the template.
    if (seen.has(token)) continue
    seen.add(token)
    // Cosmetic tokens carry a safe default and must never block a send.
    if (Object.prototype.hasOwnProperty.call(COSMETIC_DEFAULTS, token)) continue
    const provided = ctx[token]
    const val = typeof provided === 'string' ? provided.trim() : ''
    if (!val) {
      missing.push(token)
      continue
    }
    if (URL_TOKENS.has(token) && !isAbsoluteUrl(val)) {
      missing.push(token)
    }
  }
  return missing
}

/** The CANONICAL merge-variable keys referenced by a template body (any casing is normalized). */
export function tokensIn(body: string): string[] {
  const found = new Set<string>()
  for (const m of body.matchAll(TOKEN_RE)) found.add(canonicalVarKey(m[1]))
  return [...found]
}
