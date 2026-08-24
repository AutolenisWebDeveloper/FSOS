// src/lib/comms/stop-intent.ts
// PURE natural-language "stop the automated outreach" / clear-disinterest detector
// (FSOS-020). No DB, no clock — unit-testable offline (tests/comms-stop-intent.test.mjs).
//
// WHY THIS EXISTS. Carrier-standard opt-out (keywords.ts `classifyKeyword`) recognizes a STOP
// only as the FIRST WORD of a reply (stop/unsubscribe/cancel/…), and that path is the GLOBAL
// channel opt-out (DNC + consent revoke). A customer who declines in natural language — "please
// stop texting me", "remove me from your list", "not interested" — was NOT recognized, so the
// reply only PAUSED the enrollment and the resume-paused job later re-enrolled them (FSOS-020).
//
// This detector recognizes those natural-language stop/decline requests so the inbound handler
// can TERMINATE automated campaign continuation (an absorbing state) and hand the thread to a
// human — a CAMPAIGN TERMINATION distinct from the carrier global opt-out (it does NOT write
// DNC/consent-revoke; see comms/inbound.ts). It is deliberately HIGH-PRECISION: an ambiguous or
// merely-busy reply ("not right now", "call me later") must NOT match, because a false positive
// would terminate a benign conversation. A miss simply falls through to the existing benign
// pause/resume behavior — the conservative default.

export type StopIntentKind = 'stop_request' | 'disinterest'

export interface StopIntentResult {
  /** True → the reply is an unambiguous request to stop automated outreach / a clear decline. */
  matched: boolean
  /** Which family matched (for audit + observability). */
  kind: StopIntentKind | null
  /** The matched phrase (for the escalation note + audit; never the whole body). */
  phrase: string | null
}

// Explicit requests to CEASE CONTACT. Each requires a stop/negation paired with a
// contact verb (or an unambiguous opt-out phrase) so ordinary words never trip it.
const STOP_REQUEST_PATTERNS: RegExp[] = [
  // stop <contact-verb> — "please stop texting me", "stop contacting us"
  /\bstop\s+(texting|txt(?:ing)?|messaging|msg(?:ing)?|calling|call(?:ing)?|emailing|e-?mailing|contacting|reaching(?:\s+out)?|bothering|harassing|sending|mailing)\b/i,
  // stop the texts / stop it / stop now (as a cease request)
  /\bstop\s+(the\s+)?(texts?|messages?|emails?|calls?|mail|contact|communications?)\b/i,
  // do not / don't / quit / no longer <contact-verb> me|us
  /\b(?:do\s*n['’o]?t|don['’o]?t|dont|never|no\s+longer|quit|stop)\s+(?:contact|text|txt|call|email|e-?mail|message|msg|reach|bother|mail)(?:ing)?\s+(?:me|us)\b/i,
  // take / remove me off|from (your list, etc.)
  /\b(take|remove|delete)\s+me\s+(off|from)\b/i,
  // remove/delete my number|info|contact|details
  /\b(remove|delete|lose|forget)\s+(my\s+)?(number|info(?:rmation)?|contact|details?|email|phone)\b/i,
  // unsubscribe me / opt me out / opt out
  /\bunsubscribe\s+me\b/i,
  /\bopt(?:\s|-)?me(?:\s|-)?out\b/i,
  /\bopt(?:\s|-)?out\b/i,
  // leave me alone
  /\bleave\s+(me|us)\s+alone\b/i,
  // no more texts/messages/emails/calls/contact
  /\bno\s+(more|further)\s+(texts?|messages?|emails?|calls?|contact|communications?|mail)\b/i,
  // I/we don't want any more / to be contacted / these messages
  /\b(?:i|we)\s+(?:do\s*n['’o]?t|don['’o]?t|dont)\s+want\s+(?:any\s*more|to\s+(?:be\s+contacted|get|receive|hear)|these|more\s+(?:texts?|messages?|emails?|calls?))\b/i,
]

// Clear DISINTEREST / decline (category C). Kept narrow: an unambiguous "not interested"
// family only. Softer/ambiguous replies ("no thanks", "not right now") are intentionally
// left to benign pause/resume to avoid over-terminating a recoverable conversation.
const DISINTEREST_PATTERNS: RegExp[] = [
  /\b(?:i['’]?m|we['’]?re|im|we\s+are|i\s+am)?\s*not\s+interested\b/i,
  /\bno\s+longer\s+interested\b/i,
  /\bnot\s+a\s+good\s+fit\b/i,
]

// NEGATION GUARDS — phrasings that CONTAIN a stop/decline token but are NOT a cease request:
//   "I can't stop texting you", "non-stop calls", "not interested rate" is not a phrase we emit.
// If the body matches a guard, a `stop_request` match is suppressed (disinterest is unaffected —
// "not interested" has no benign homograph in this set).
const NEGATION_GUARDS: RegExp[] = [
  // negated "stop" — a message that is NOT a cease request: "I can't stop texting you",
  // "won't stop", "never stop". English contractions vary (can't = can+'t, won't = wo+n't,
  // don't = do+n't), so the negators are enumerated explicitly.
  /\b(?:can['’]?t|cannot|could\s*n['’]?t|would\s*n['’]?t|wo\s*n['’]?t|won['’]?t|do\s*n['’]?t|don['’]?t|does\s*n['’]?t|did\s*n['’]?t|never)\s+stop\b/i,
  /\bnon-?stop\b/i, // non-stop / nonstop
]

function firstMatch(body: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(body)
    if (m) return m[0].trim()
  }
  return null
}

/**
 * Detect an unambiguous natural-language request to STOP automated outreach, or a clear
 * expression of DISINTEREST. Returns matched=false for anything ambiguous or benign.
 *
 * NOTE: carrier keyword opt-out (a first-word STOP/UNSUBSCRIBE/CANCEL/…) is handled separately
 * by keywords.ts `classifyKeyword` and remains the GLOBAL channel opt-out path. This detector is
 * for the NON-first-word natural-language case and drives CAMPAIGN TERMINATION (not DNC).
 */
export function detectStopAutomation(body: string): StopIntentResult {
  const text = (body || '').trim()
  if (!text) return { matched: false, kind: null, phrase: null }

  const stopPhrase = firstMatch(text, STOP_REQUEST_PATTERNS)
  if (stopPhrase && !NEGATION_GUARDS.some((g) => g.test(text))) {
    return { matched: true, kind: 'stop_request', phrase: stopPhrase }
  }

  const disinterestPhrase = firstMatch(text, DISINTEREST_PATTERNS)
  if (disinterestPhrase) {
    return { matched: true, kind: 'disinterest', phrase: disinterestPhrase }
  }

  return { matched: false, kind: null, phrase: null }
}
