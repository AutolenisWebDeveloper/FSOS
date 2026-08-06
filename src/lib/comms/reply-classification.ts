// src/lib/comms/reply-classification.ts
// Classification of an AI-drafted CONVERSATION REPLY (PURE). Master build instruction §11.
//
// WHY THIS EXISTS. Every aiGenerated send is evaluated by the AI-authority matrix
// (ai-authority.ts) plus the §12 evaluations (evaluations.ts) before dispatch. Both need
// two things the inbound reply path never supplied: the AI message CLASS and the message
// PURPOSE. Without them the reply was held as an FSA draft on every single turn — not
// because anything was wrong with it, but because nothing had classified it. The console
// initiator (/api/comms/conversations/start) and all three campaign ticks already classify
// their sends; this module is the equivalent for a reply, where — unlike an opener — the
// content is not known in advance and must be derived from the actual exchange.
//
// FAIL-CLOSED BY CONSTRUCTION. This never returns a permissive default. An auto-send class
// is returned ONLY when the reply is positively recognised as one of the narrow green-zone
// shapes AND neither the contact's message nor the draft touches a regulated topic. Anything
// else returns `messageClass: null`, which evaluateAiAuthority() treats as unclassified and
// fails safe to draft_only — held for the licensed FSA, never auto-sent. Adding a topic to
// the risk lists below can only ever make FSOS more restrictive.
//
// TWO-SIDED CHECK. Risk topics are matched against the CONTACT'S message as well as the
// draft. A bland-looking reply to "what would my premium be?" must not auto-send: answering
// it at all opens an advisory thread, and the next turn is where the red line gets crossed.
//
// KNOWN LIMITATION (documented, tested, pinned). The topic lists recognise PHRASINGS, and
// some colloquial ones are missed ("what's the damage gonna be each month" vs "what would my
// premium be"). The consequence is bounded by the allowlist, not by the lists: a missed
// phrasing means the reply is a SCHEDULING INVITATION rather than a hold — never an answer,
// because the four auto-send shapes are structurally contentless. See
// docs/compliance/ai-reply-classification.md §6 (written for a compliance reader) and the
// RESIDUAL checks in tests/comms-reply-classification.test.mjs.
//
// Pure + relative imports (no DB, no clock) so it is unit-testable offline, matching
// gate.ts / ai-authority.ts / evaluations.ts.

import type { AiMessageClass } from './ai-authority'
import type { MessagePurpose } from './purpose'

export interface ReplyClassificationInput {
  /** The contact's inbound message that triggered this reply. */
  inboundBody: string
  /** The reply the responder drafted. */
  draft: string
  /**
   * The responder itself declined to answer and substituted its fixed hand-off text
   * (responder.ts `escalateOnly`). Treated as unclassified: the model has already said this
   * is not something it should answer, so the reply goes to the FSA rather than out.
   */
  modelHandedOff?: boolean
}

export interface ReplyClassification {
  /** null ⇒ unclassified ⇒ evaluateAiAuthority() fails safe to draft_only. */
  messageClass: AiMessageClass | null
  /**
   * Always SERVICING. A reply is the FSA servicing a question the contact just asked — it is
   * never marketing or relationship outreach, and SERVICING is priority rank 1, so the §10
   * active-conversation collision rule (which pauses rank > 3) can never pause the very
   * conversation that triggered it.
   */
  purpose: MessagePurpose
  /** Human-readable basis for the decision — recorded on the hold/escalation. */
  reason: string
  /**
   * A human moment, not merely a regulated one: bereavement, serious illness, financial
   * hardship, or an angry/complaint message. Computed INDEPENDENTLY of which class won, so an
   * exchange that is both (say) securities and bereavement is still flagged. The caller uses
   * it to escalate under a distinct, filterable reason — these must reach a person quickly,
   * not sit in the queue behind routine holds.
   */
  urgent: boolean
}

/**
 * Families that are a HUMAN moment rather than only a regulated one. Flagged independently of
 * which class wins the label, so a message that is both securities and bereavement still
 * escalates as urgent.
 */
const URGENT_CLASSES: ReadonlySet<AiMessageClass> = new Set<AiMessageClass>([
  'bereavement_or_hardship',
  'complaint_or_dispute',
])

/** Regulated topics → the draft-only (or blocked) class each one implies. Order matters. */
const RISK_TOPICS: ReadonlyArray<{ cls: AiMessageClass; label: string; patterns: RegExp[] }> = [
  {
    cls: 'securities_related',
    label: 'securities',
    // Firewall §4.1 — never sent from FSOS regardless of who is asking.
    patterns: [
      /\b401\s*\(?k\)?\b/i, /\b403\s*\(?b\)?\b/i, /\bira\b/i, /\broth\b/i,
      /\bmutual\s+funds?\b/i, /\bannuit(y|ies)\b/i, /\bbrokerage\b/i, /\bportfolio\b/i,
      /\bsecurit(y|ies)\s+(account|holding)/i, /\betfs?\b/i, /\bstocks?\b/i, /\bbonds?\b/i,
      /\broll\s*over\b/i, /\brollover\b/i, /\bvariable\s+(annuity|life|universal)\b/i,
      /\binvest(ing|ment|ments)?\b/i, /\bmarket\s+(return|performance)\b/i,
    ],
  },
  {
    cls: 'bereavement_or_hardship',
    label: 'bereavement, serious illness or financial hardship',
    // NOT an advice risk — a HUMAN one. Answering "my husband passed away, does our policy
    // pay out?" with a scheduling invitation is a service failure, and the automation has no
    // business being the first responder to it. Held so the contact gets a person.
    patterns: [
      /\bpassed\s+away\b/i,
      /\b(he|she|they|mom|mother|dad|father|husband|wife|spouse|son|daughter|partner|brother|sister)\s+passed\b/i,
      /\bdied\b/i, /\bdeceased\b/i, /\bfuneral\b/i, /\bwidow(ed|er)?\b/i,
      /\bdeath\s+in\s+the\s+family\b/i, /\b(his|her|their)\s+death\b/i,
      /\blost\s+(my|our)\s+(husband|wife|spouse|mother|father|mom|dad|son|daughter|partner|child)\b/i,
      /\bhospice\b/i, /\bterminal(ly)?\s+ill\b/i, /\bseriously\s+ill\b/i,
      // Financial hardship — the other case where an automated nudge lands badly.
      /\blost\s+my\s+job\b/i, /\blaid\s+off\b/i, /\bcan'?t\s+afford\b/i,
      /\bcan'?t\s+(make|pay)\s+(the|my|this|next)\b/i, /\bfinancial\s+hardship\b/i,
      /\bbehind\s+on\s+(my|the|our)\s+payments?\b/i, /\bstruggling\s+to\s+pay\b/i,
      /\bdivorc(e|ed|ing)\b/i,
    ],
  },
  {
    cls: 'sensitive_data_request',
    label: 'sensitive personal data',
    patterns: [
      /\bssn\b/i, /\bsocial\s+security\s+(number|#)/i, /\brouting\s+number\b/i,
      /\baccount\s+number\b/i, /\bcredit\s+card\b/i, /\bdate\s+of\s+birth\b/i, /\bdob\b/i,
      /\bdriver'?s?\s+licen[cs]e\b/i,
    ],
  },
  {
    cls: 'complaint_or_dispute',
    label: 'complaint or dispute',
    // Deliberately wider than the literal word "complaint": an upset contact rarely uses it.
    // Every pattern here only ever causes a HOLD, so over-matching costs a scheduling
    // invitation, while under-matching answers an angry message with a booking link.
    patterns: [
      /\bcomplain(t|ing|ts)?\b/i, /\battorney\b/i, /\blawyer\b/i, /\bsue\b|\bsuing\b|\blawsuit\b/i,
      /\bfile\s+a\s+(complaint|grievance)\b/i, /\bdispute\b/i, /\brefund\b/i,
      /\bfurious\b/i, /\bangry\b/i, /\boutrage(d|ous)?\b/i, /\bunacceptable\b/i,
      /\bridiculous\b/i, /\bappalling\b/i, /\bdisgust(ed|ing)\b/i, /\bfed\s+up\b/i,
      /\bnobody\s+(has\s+)?(called|got\s+back|responded)/i, /\bno\s+one\s+(has\s+)?(called|got\s+back|responded)/i,
      /\b(speak|talk)\s+to\s+(a|your)\s+(manager|supervisor)\b/i, /\bescalate\s+this\b/i,
      /\bthis\s+is\s+(unacceptable|ridiculous|absurd)\b/i,
    ],
  },
  {
    cls: 'replacement_discussion',
    label: 'policy replacement or surrender',
    patterns: [
      /\breplac(e|ing|ement)\s+(my|the|this|your)?\s*(policy|coverage|plan)?\b/i,
      /\bsurrender\b/i, /\b1035\b/, /\bcancel\s+(my|the)\s+(policy|coverage|plan)\b/i,
      /\bswitch\s+(carriers?|policies|companies)\b/i,
    ],
  },
  {
    cls: 'underwriting_question',
    label: 'underwriting or medical',
    patterns: [
      /\bunderwrit(e|ing|er)\b/i, /\bmedical\s+(exam|history|records?)\b/i, /\bparamed\b/i,
      /\bhealth\s+questions?\b/i, /\btobacco\b/i, /\bnicotine\b/i, /\bpre-?existing\b/i,
      /\bam\s+i\s+(eligible|approved|insurable)\b/i, /\bdeclined\s+(for|by)\b/i,
    ],
  },
  {
    cls: 'pricing_premium',
    label: 'pricing or premium',
    patterns: [
      /\bpremium(s)?\b/i, /\bquote\b/i, /\bhow\s+much\s+(would|will|does|is|do)\b/i,
      /\bwhat\s+(would|will)\s+it\s+cost\b/i, /\bmonthly\s+(cost|payment|rate)\b/i,
      /\bprice\b/i, /\brates?\s+(for|on)\b/i, /\bcost\s+(of|for)\b/i, /\baffordabl/i,
    ],
  },
  {
    cls: 'term_conversion_interpretation',
    label: 'term conversion',
    // NB "term life" as a product CATEGORY is green-zone education and is deliberately NOT
    // matched here — only conversion mechanics, which are carrier-specific and unverified (§4.3).
    patterns: [
      /\bconversion\s+(window|period|deadline|privilege|option)\b/i,
      /\bconvert(ing|ed)?\s+(my|the|this|your|to)\b/i, /\bterm\s+conversion\b/i,
    ],
  },
  {
    cls: 'policy_specific_explanation',
    label: 'the contact’s own policy',
    patterns: [
      // The possessive list must cover a third party's contract too — a survivor asking about
      // "our policy" or "his coverage" is the exact case this family exists for.
      /\b(my|your|the|our|his|her|their)\s+polic(y|ies)\b/i, /\bpolicy\s+(number|#)\b/i,
      /\bdeath\s+benefit\b/i, /\bcash\s+value\b/i, /\bface\s+amount\b/i, /\bbeneficiar(y|ies)\b/i,
      /\b(my|your|our|his|her|their)\s+coverage\b/i, /\brider\b/i, /\blapse(d)?\b/i,
      /\bpay\s*out\b/i, /\bpayout\b/i,
    ],
  },
  {
    cls: 'product_comparison',
    label: 'product comparison',
    patterns: [
      /\bwhole\s+life\s+(or|vs\.?|versus)\b/i, /\bterm\s+(or|vs\.?|versus)\s+(whole|permanent|universal)\b/i,
      /\bcompare(d)?\s+(to|with)\b/i, /\bbetter\s+than\b/i, /\bwhich\s+(one|policy|product|plan)\s+is\b/i,
      /\bdifference\s+between\s+.*\b(life|policy|plan|coverage)\b/i,
    ],
  },
  {
    cls: 'needs_analysis_conclusion',
    label: 'coverage-need conclusion',
    patterns: [
      /\bhow\s+much\s+(coverage|insurance|life\s+insurance)\s+(do|should|would)\b/i,
      /\bhow\s+much\s+do\s+i\s+need\b/i, /\benough\s+coverage\b/i,
      /\bright\s+amount\s+of\s+(coverage|insurance)\b/i,
    ],
  },
  {
    cls: 'case_or_application_affecting',
    label: 'an open application or claim',
    patterns: [
      /\b(my|the)\s+application\b/i, /\b(file|filing)\s+a\s+claim\b/i, /\b(my|the)\s+claim\b/i,
      /\bstatus\s+of\s+(my|the)\b/i, /\bpaperwork\b/i, /\bsubmitted\s+(my|the)\b/i,
    ],
  },
  {
    cls: 'financial_recommendation',
    label: 'a request for advice or a recommendation',
    patterns: [
      /\bwhat\s+(do\s+you|would\s+you)\s+(recommend|suggest|advise)\b/i,
      /\bshould\s+i\b/i, /\bwhat\s+would\s+you\s+do\b/i, /\byour\s+advice\b/i,
      /\bbest\s+(option|choice|plan|policy|product)\b/i, /\bmakes?\s+sense\s+for\s+me\b/i,
      /\bwhat\s+do\s+you\s+think\s+i\s+should\b/i,
    ],
  },
]

/**
 * Narrow green-zone reply shapes that MAY auto-send (all present in the ai-authority
 * AUTO_SEND set). Evaluated against the DRAFT only, and only after every risk topic above
 * has been ruled out on both sides of the exchange.
 */
const SAFE_SHAPES: ReadonlyArray<{ cls: AiMessageClass; label: string; patterns: RegExp[] }> = [
  {
    cls: 'scheduling_link',
    label: 'a scheduling link',
    patterns: [/https?:\/\/\S*\b(book|schedule|calendar|appointment|meet)\b/i],
  },
  {
    cls: 'availability_question',
    label: 'an availability question',
    patterns: [
      /\bwhat\s+(day|time|times)\b/i, /\bwhen\s+(works|would\s+work|are\s+you)\b/i,
      /\bwould\s+you\s+like\s+(me\s+)?to\s+(set\s+up|schedule|find)\b/i,
      /\bare\s+you\s+(free|available)\b/i, /\bset\s+up\s+a\s+time\b/i,
      /\bfind\s+a\s+time\b/i, /\bschedule\s+(a|some)\s+time\b/i, /\bbook\s+a\s+time\b/i,
      /\bavailabilit(y|ies)\b/i,
    ],
  },
  {
    cls: 'receipt_acknowledgment',
    label: 'an acknowledgment of receipt',
    patterns: [/\bgot\s+it\b/i, /\breceived\s+(your|that|it)\b/i, /\bpassing\s+(this|that)\s+along\b/i],
  },
  {
    cls: 'approved_thank_you',
    label: 'a thank-you',
    patterns: [/\bthanks?\s+(for|so\s+much)\b/i, /\bthank\s+you\b/i, /\bappreciate\s+(it|you)\b/i],
  },
]

/**
 * Longest reply that can still be a simple green-zone acknowledgment/scheduling turn. A
 * longer draft is substantive by volume regardless of what it matched, so it goes to the
 * FSA. (The responder is instructed to keep SMS under 320 characters; this leaves headroom
 * for email without letting an essay through.)
 */
const MAX_AUTO_SEND_CHARS = 480

function matches(topic: { patterns: RegExp[] }, text: string): boolean {
  return topic.patterns.some((re) => re.test(text))
}

/**
 * Classify an AI-drafted conversation reply for the §11 authority matrix and the §9 purpose
 * policy. Returns `messageClass: null` for anything not positively recognised as green-zone —
 * the caller passes that straight through and the authority matrix holds it for the FSA.
 */
export function classifyReply(input: ReplyClassificationInput): ReplyClassification {
  const purpose: MessagePurpose = 'SERVICING'
  const draft = input.draft ?? ''
  const inbound = input.inboundBody ?? ''
  // Risk is assessed over BOTH sides: what the contact raised and what we are about to say.
  const exchange = `${inbound}\n${draft}`

  // Urgency is resolved over EVERY family, not just the one that wins the label, so a message
  // that is both securities and bereavement is still routed as a human moment.
  const urgent = RISK_TOPICS.some((t) => URGENT_CLASSES.has(t.cls) && matches(t, exchange))

  for (const topic of RISK_TOPICS) {
    if (matches(topic, exchange)) {
      return {
        messageClass: topic.cls,
        purpose,
        urgent,
        reason: `exchange touches ${topic.label} — ${topic.cls} requires licensed FSA review`,
      }
    }
  }

  if (input.modelHandedOff) {
    return {
      messageClass: null,
      purpose,
      urgent,
      reason: 'the responder declined to answer and substituted its hand-off text — routed to the FSA',
    }
  }

  if (draft.length > MAX_AUTO_SEND_CHARS) {
    return {
      messageClass: null,
      purpose,
      urgent,
      reason: `draft is ${draft.length} characters (over ${MAX_AUTO_SEND_CHARS}) — too substantive to auto-send`,
    }
  }

  for (const shape of SAFE_SHAPES) {
    if (matches(shape, draft)) {
      return { messageClass: shape.cls, purpose, urgent, reason: `green-zone reply: ${shape.label}` }
    }
  }

  return {
    messageClass: null,
    purpose,
    urgent,
    reason: 'reply did not match a recognised green-zone shape — fail-safe to FSA review',
  }
}
