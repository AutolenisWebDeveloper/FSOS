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
  // bare "please stop" / "pls stop" (but NOT "please stop by …" — that's a visit, not a cease)
  /\b(?:please|pls|kindly)\s+stop\b(?!\s+by\b)/i,
  // do not / don't / quit / no longer <contact-verb> me|us — but NOT a contact CORRECTION
  // ("don't email me AT that address / ON that number", which is a fix, not a cease).
  /\b(?:do\s*n['’o]?t|don['’o]?t|dont|never|no\s+longer|quit|stop)\s+(?:contact|text|txt|call|email|e-?mail|message|msg|reach|bother|mail)(?:ing)?\s+(?:me|us)\b(?!\s+(?:at|on)\b)/i,
  // take / remove / delete me (off/from a list, or just "remove me")
  /\b(take|remove|delete)\s+me\b/i,
  // remove/delete/lose my number|info|contact|details ("forget" dropped — too colloquial/ambiguous)
  /\b(remove|delete|lose)\s+(my\s+)?(number|info(?:rmation)?|contact|details?|email|phone)\b/i,
  // unsubscribe (any form) / opt me out / opt out — covers "I want to unsubscribe" (negation-guarded)
  /\bunsubscrib\w*\b/i,
  /\bopt(?:\s|-)?me(?:\s|-)?out\b/i,
  /\bopt(?:\s|-)?out\b/i,
  // leave me alone
  /\bleave\s+(me|us)\s+alone\b/i,
  // no more texts/messages/emails/calls/contact
  /\bno\s+(more|further)\s+(texts?|messages?|emails?|calls?|contact|communications?|mail)\b/i,
  // I/we don't want any more / to be contacted / these messages
  /\b(?:i|we)\s+(?:do\s*n['’o]?t|don['’o]?t|dont)\s+want\s+(?:any\s*more|to\s+(?:be\s+contacted|get|receive|hear)|these|more\s+(?:texts?|messages?|emails?|calls?))\b/i,
]

// Clear DISINTEREST / decline (category C). Kept narrow: an unambiguous "not interested" family.
// The `(?!\s+in\b)` lookahead excludes a SUB-TOPIC or MEANING-FLIPPED qualifier — "not interested
// IN the premium option, but tell me about the basic plan" (still engaged) and "not interested IN
// unsubscribing" (the opposite) — leaving those to benign pause/resume. Softer replies ("no
// thanks", "not right now") are also intentionally left benign to avoid over-terminating.
const DISINTEREST_PATTERNS: RegExp[] = [
  /\bnot\s+interested\b(?!\s+in\b)/i,
  /\bno\s+longer\s+interested\b(?!\s+in\b)/i,
  /\bnot\s+a\s+good\s+fit\b/i,
]

// NEGATION GUARDS — phrasings that CONTAIN a cease token but are NOT a cease request. If a guard
// matches, a `stop_request` match is suppressed. `NEGATED_INTENT` catches a negator that NEGATES
// the ceasing — the customer wants to CONTINUE ("please don't ever stop texting me", "I don't want
// to opt out", "never want you to stop"). The words allowed between the negator and the cease verb
// are a SMALL CLOSED filler set, so a genuine cease request that merely has a negator earlier in a
// different clause ("don't contact me, and stop texting me") is NOT suppressed.
const NEGATION_GUARDS: RegExp[] = [
  /\b(?:can['’]?t|cannot|could\s*n['’]?t|would\s*n['’]?t|wo\s*n['’]?t|won['’]?t|do\s*n['’]?t|don['’]?t|does\s*n['’]?t|did\s*n['’]?t|never|not)\b(?:\s+(?:ever|even|you|really|just|want|wanna|gonna|going|like|to|me|us|please))*\s+(?:stop|opt(?:\s|-)?(?:me\s+)?out|unsubscrib\w*|leave|cancel)\b/i,
  /\bnon-?stop\b/i, // non-stop / nonstop
  // "interested in <ceasing>" — a cease token embedded as the OBJECT of interest, i.e.
  // meaning-flipped ("not interested in unsubscribing" = wants to stay). The cease verb must
  // DIRECTLY follow "interested in", so a genuine comma-separated stop ("not interested,
  // unsubscribe me") is NOT suppressed.
  /\binterested\s+in\s+(?:un-?subscrib\w*|opt\w*|stopp?\w*|cancel\w*|leav\w*)\b/i,
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
