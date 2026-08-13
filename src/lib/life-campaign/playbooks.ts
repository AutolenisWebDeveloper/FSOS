// src/lib/life-campaign/playbooks.ts
// The five Life Conversion AI conversation playbooks and two advisor-outreach scripts as PURE,
// versioned data. Each playbook is an internal script the AI conversation engine grounds on;
// every substantive/individualized question routes to advisor escalation (conversation.ts /
// §4.2 red-line). The AI-conversation touch (§5) sends the playbook `opening` as a
// comm_template (category life_conversion_ai, migration 110); the branch/escalation metadata
// drives classification and handoff and is surfaced in the campaign detail view.
//
// This module fills a gap rather than adding a pattern: pipeline-winback and cross-sell-life
// already carry exactly this artifact. The field shape is shared with both sibling modules so
// all three campaigns present ONE playbook model (CLAUDE.md §6).
//
// ── AUDIENCE + THE VERIFIED-FACTS CONTRACT (messaging v4, owner-directed 2026-08-07) ─────────
// These recipients own an in-force Farmers TERM policy that carries a conversion privilege with
// a VERIFIED deadline: the enrollment population comes exclusively from v_conversions_due (the
// imported FNWL conversion list — verified conversion_deadline, policy_number, and convertible
// amount as face_amount). The campaign is ABOUT that privilege: eligible term coverage may be
// converted to permanent life insurance before the recipient's own verified deadline.
//
// The copy may therefore state the VERIFIED facts — and only those. Every fact resolves
// per-recipient through BLOCKING-tier merge tokens ({{conversion_expiration_date}},
// {{days_until_conversion_expires}}, …) that fail closed at gate step `personalization`
// (§4.3 / ADR-020): a recipient whose record lacks a referenced fact is blocked + escalated,
// never sent a guess. IMPORTANT DISPATCH-PATH SPLIT: fact tokens are allowed ONLY in `opening`
// (dispatched by the campaign tick, which supplies enrollment.policy_id to the gate);
// followUp/handoff/closing are dispatched later by the AI responder with NO policy context, so
// they must stay fact-token-free or every such send would hard-block. Enforced by
// tests/lifecycle-campaign-messaging.test.mjs.
//
// The "no new medical exam" claim has its own verified gate ({{conversion_exam_clause}} +
// household_policies.conversion_no_exam, migration 109) and is made in EMAIL copy only — the
// AI never asserts underwriting/exam facts in its own words.
//
// The red line is unchanged (§4.2): the AI never recommends converting, never names a product
// to convert into, never quotes a premium, never assesses suitability, and never discusses
// replacing coverage. It states verified facts, explains the privilege in GENERAL terms,
// books the complimentary conversion review, and escalates everything individualized to the
// licensed FSA.

export interface Playbook {
  key: string
  /** The §5 touch that fires this playbook. */
  touch_no: number
  title: string
  objective: string
  /** The opening line (seeded as a comm_template, category life_conversion_ai). */
  opening: string
  /** Intent branches the AI may explore with GENERAL educational information only. */
  branches: string[]
  /** What the AI is allowed to say/do (green zone). */
  allowed: string
  /** Prohibited behavior (red line, §4.2). */
  prohibited: string
  /** The single nudge the AI sends when a client does not reply to the opening. */
  followUp: string
  /** The verbatim message the AI sends when handing the conversation to the licensed FSA. */
  handoff: string
  /** The verbatim message the AI sends when closing the conversation out. */
  closing: string
  /** Intents that end the AI's turn and hand to the advisor (mirrors COMPLIANCE_SENSITIVE_INTENTS). */
  escalateOn: string[]
  /** Conditions under which the playbook closes the conversation (feeds the §13 state machine). */
  exitConditions: string[]
}

// Every escalation list includes the four that are non-negotiable for an existing policyholder:
// anything about their specific contract, anything about cost, anything medical, and any hint of
// replacement. The AI answers none of these — including "should I convert?", which is precisely
// the individualized recommendation the red line reserves for the licensed FSA.
const POLICYHOLDER_ESCALATIONS = [
  'policy_specifics',
  'existing_coverage',
  'replacement',
  'conversion_question',
  'cost_concern',
  'pricing',
  'quote',
  'coverage_amount',
  'eligibility_question',
  'medical_question',
  'underwriting',
  'beneficiary_change',
  'claim',
  'tax',
  'legal',
  'complaint',
  'advisor_request',
  'unknown',
]

export const PLAYBOOKS: Playbook[] = [
  {
    key: 'conversion_check_in',
    touch_no: 3,
    title: 'Conversation #1 — Initial Conversion Check-In',
    objective:
      'Make the verified conversion window visible, offer the complimentary conversion review, and route to booking, a question, or a clean exit.',
    opening:
      "Hi {{first_name}}, I'm the automated assistant for {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. Your term conversion option expires {{conversion_expiration_date}}. Free review, question, or not now?",
    branches: ['book_review', 'ask_question', 'not_now', 'not_interested', 'what_is_this', 'unknown'],
    allowed:
      'Explain in general terms that a term-conversion privilege lets eligible term coverage become permanent life insurance before the deadline on the policy, and that the review covers the available choices with free permanent-coverage quotes and no obligation. Offer to book time with {{fsa_name}}.',
    prohibited:
      'Never go beyond the verified facts on file. Never say whether converting would be right for the recipient, never name a product to convert into, never quote a premium, never state exam or underwriting requirements, and never suggest their existing coverage is inadequate.',
    followUp:
      'No reply needed if the timing is wrong, {{first_name}}. One word is plenty: BOOK, QUESTION, or NO. Any of the three is a good answer.',
    handoff:
      "That's about your specific policy, so it needs a licensed person rather than an assistant. I'm passing this to {{fsa_name}}, who will come back to you directly.",
    closing:
      "Understood, {{first_name}}, I'll close this out. Your coverage stays exactly as it is, and nothing changes. Thanks for your time.",
    escalateOn: POLICYHOLDER_ESCALATIONS,
    exitConditions: ['appointment booked', 'advisor requested', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'how_conversion_works',
    touch_no: 6,
    title: 'Conversation #2 — How Conversion Works',
    objective:
      'Educate in general terms on what a term-conversion privilege is, so the recipient can decide whether a review is worth their time.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Do you know how the conversion option on your term policy works? I can explain in general terms, or book you a free review before {{conversion_expiration_date}}.",
    branches: ['explain_generally', 'book_review', 'ask_question', 'already_know', 'not_interested', 'unknown'],
    allowed:
      'Give the general explanation: term coverage runs for a set period; a conversion privilege lets eligible term coverage be converted to permanent coverage before the policy deadline; the specifics live in the contract and are what the review establishes. Offer to book time with {{fsa_name}}.',
    prohibited:
      "Never state what the recipient's own contract permits beyond the verified deadline on file, never quantify costs or amounts, and never characterize conversion as the right or best choice for them. Anything individualized escalates.",
    followUp:
      'Happy to leave it here if the timing is wrong, {{first_name}}. If you would like the short general explanation or a review later, one word does it: EXPLAIN or BOOK.',
    handoff:
      "That question is about your specific contract, and I would only be guessing. I'm passing it to {{fsa_name}}, who can read your actual policy and give you a real answer.",
    closing:
      "Thanks for the time, {{first_name}}. I'll leave it there. If a question about the conversion option comes up later, reply here and {{fsa_name}} will pick it up.",
    escalateOn: POLICYHOLDER_ESCALATIONS,
    exitConditions: ['general explanation given', 'appointment booked', 'advisor requested', 'not interested'],
  },
  {
    key: 'partial_conversion',
    touch_no: 10,
    title: 'Conversation #3 — Partial Conversion',
    objective:
      'Surface the fact that conversion is not all-or-nothing, which removes the most common reason people dismiss it without a review.',
    opening:
      "Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. Converting your term policy is not all or nothing - a portion of eligible coverage may qualify. Want a free review of your choices before {{conversion_expiration_date}}?",
    branches: ['book_review', 'how_partial_works', 'ask_question', 'not_interested', 'unknown'],
    allowed:
      'Explain in general terms that many term policies allow converting only part of the eligible coverage while the rest stays term, and that which portions and options apply is exactly what the review reads out of the contract. Offer to book time with {{fsa_name}}.',
    prohibited:
      'Never state what portion of the recipient\'s coverage is convertible, never suggest an amount to convert, and never discuss premiums. A "how much should I convert" question is an individualized recommendation and escalates immediately.',
    followUp:
      'No pressure either way, {{first_name}}. If knowing your partial-conversion choices would help, reply BOOK and I will set up the free review.',
    handoff:
      "What applies to your specific coverage needs a licensed person with your contract in front of them. I'm handing this to {{fsa_name}} to walk you through it properly.",
    closing:
      "No problem at all, {{first_name}}. I'll close this out, and you can reply here whenever a question comes up.",
    escalateOn: POLICYHOLDER_ESCALATIONS,
    exitConditions: ['appointment booked', 'question escalated to advisor', 'not interested'],
  },
  {
    key: 'deadline_check',
    touch_no: 15,
    title: 'Conversation #4 — Deadline Check',
    objective:
      'State the verified time remaining plainly and capture a decision path while there is still comfortable room before the deadline.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Your conversion window closes {{conversion_expiration_date}}, {{days_until_conversion_expires}} days from now. Book a free review, ask a question, or leave it for now?",
    branches: ['book_review', 'ask_question', 'leave_it', 'not_interested', 'unknown'],
    allowed:
      'State the verified deadline and days remaining, note that after the deadline the conversion option is no longer part of the policy, and make clear there is no obligation to convert anything. Offer to book time with {{fsa_name}}.',
    prohibited:
      'Never manufacture urgency beyond the verified date, never imply the recipient will be harmed by declining, and never recommend converting. The deadline is stated as fact, not as pressure.',
    followUp:
      "One line back is plenty, {{first_name}}: BOOK, QUESTION, or LEAVE IT. Any of the three is a fine answer, and LEAVE IT simply means your coverage carries on as is.",
    handoff:
      "That deserves a licensed answer rather than an assistant's. I'm passing you to {{fsa_name}}, who will come back to you before your window closes.",
    closing:
      "Understood, {{first_name}}. I'll leave it with you. If you change your mind while the window is open, reply here any time.",
    escalateOn: POLICYHOLDER_ESCALATIONS,
    exitConditions: ['appointment booked', 'advisor requested', 'declined for now', 'not interested'],
  },
  {
    key: 'final_invitation',
    touch_no: 18,
    title: 'Conversation #5 — Final Invitation',
    objective: 'Close the campaign respectfully, capture a future follow-up if wanted, and preserve the relationship.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant one last time. Your conversion option ends {{conversion_expiration_date}}. Book a free review, have us check back, or close this out? Any of the three is fine.",
    branches: ['book_review', 'follow_up_later', 'close_campaign', 'not_interested', 'global_opt_out', 'advisor_requested'],
    allowed:
      'Offer the three options plainly. Honor a global opt-out by routing it to suppression handling. Thank the client and make clear their existing coverage is unaffected whichever they choose.',
    prohibited:
      'Never pressure, never use a final-chance framing beyond the factual end date, and never imply risk from declining. Never recommend a product. Never ask the client to reconsider more than once.',
    followUp:
      "I'll take the silence as a no, {{first_name}}, and close this out. Nothing further needed, and thank you for your time.",
    handoff:
      "Of course, I'll pass you to {{fsa_name}} now so you can speak with a licensed person directly.",
    closing:
      "Closed out, {{first_name}}. Your coverage carries on exactly as it is. If a question ever comes up, reply here and {{fsa_name}} will pick it straight up.",
    escalateOn: ['advisor_request', 'policy_specifics', 'replacement', 'complaint', 'unknown'],
    exitConditions: ['appointment booked', 'future follow-up scheduled', 'campaign closed', 'global opt-out requested'],
  },
]

/** Look up a playbook by its scheduled touch number. */
export function playbookForTouch(touchNo: number): Playbook | null {
  return PLAYBOOKS.find((p) => p.touch_no === touchNo) ?? null
}

export function playbookByKey(key: string): Playbook | null {
  return PLAYBOOKS.find((p) => p.key === key) ?? null
}

export interface AdvisorScript {
  /** The §5 advisor touch this fulfils. */
  touch_no: number
  key: string
  title: string
  script: string
  goals: string[]
}

// The two Advisor Outreach touches (touch 7 / day 48 and touch 13 / day 135). These are HUMAN
// tasks — the tick creates a work_task and a logged outreach ATTEMPT fulfils the touch; nothing
// here is auto-dispatched. They are conversation openers, not scripts to be read aloud. The
// advisor reads the recipient's verified deadline, policy number, and convertible amount off the
// campaign detail view (the enrollment snapshot) — the script deliberately carries no fact
// tokens, since it is spoken, not merge-rendered.
export const ADVISOR_SCRIPTS: AdvisorScript[] = [
  {
    touch_no: 7,
    key: 'conversion_review_invitation',
    title: 'Advisor Call #1 — Conversion Review Invitation',
    script:
      "Hi {{first_name}}, this is {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. I handle the life insurance side for the agency's clients, so I am a new name to you. I am calling about the term life policy you hold with us: it includes a conversion option, and that option has an expiration date. Before it passes I would like to offer you a complimentary conversion review. We would go through what the option lets you do, what converting all, some, or none of your eligible coverage would look like, and free quotes for the permanent choices, with no obligation to change anything. Would twenty minutes be useful?",
    goals: [
      'make the verified conversion window visible before it closes',
      'state explicitly that no change is being proposed on the call',
      'explain the all/some/none choice in general terms',
      'book a conversion review only where the client wants one',
    ],
  },
  {
    touch_no: 13,
    key: 'final_personal_invitation',
    title: 'Advisor Call #2 — Final Personal Invitation',
    script:
      "Hi {{first_name}}, {{fsa_name}} here. I wanted to reach out personally once more before your conversion window closes. If you are happy letting the option lapse and keeping your term coverage as it stands, that is a perfectly good decision and I will leave it there. If you have ever wanted to know what converting some or all of your eligible coverage would look like, that is a twenty-minute conversation, the quotes are free, and it costs you nothing to hear it. Either way, thank you for keeping your coverage with us.",
    goals: [
      'give the client a dignified way to let the option lapse',
      'leave one concrete, low-cost reason to review before the deadline',
      'close the invitation without pressure',
      'preserve the policyholder relationship for future service',
    ],
  },
]

export function advisorScriptForTouch(touchNo: number): AdvisorScript | null {
  return ADVISOR_SCRIPTS.find((s) => s.touch_no === touchNo) ?? null
}
