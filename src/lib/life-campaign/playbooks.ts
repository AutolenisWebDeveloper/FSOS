// src/lib/life-campaign/playbooks.ts
// The five Life Conversion AI conversation playbooks and two advisor-outreach scripts as PURE,
// versioned data. Each playbook is an internal script the AI conversation engine grounds on;
// every substantive/individualized question routes to advisor escalation (conversation.ts /
// §4.2 red-line). The AI-conversation touch (§5) sends the playbook `opening` as a
// comm_template (category life_conversion_ai, migration 101); the branch/escalation metadata
// drives classification and handoff and is surfaced in the campaign detail view.
//
// This module fills a gap rather than adding a pattern: pipeline-winback and cross-sell-life
// already carry exactly this artifact, and Life Conversion previously had AI openers seeded as
// templates with no governing playbook and two advisor touches with no script at all. The field
// shape is shared with both sibling modules so all three campaigns present ONE playbook model
// (CLAUDE.md §6).
//
// ── AUDIENCE + THE CENTRAL CONSTRAINT ─────────────────────────────────────────
// These recipients own an in-force life policy. The tempting hook — "your policy has a
// conversion option and the window is closing" — is exactly what §4.3 and ADR-020 forbid:
// term-conversion windows, product availability, and carrier rules are not publicly documented,
// and FSOS holds no verified per-policy conversion data for these contacts. Accordingly NO
// playbook may assert that the recipient's policy has a conversion option, state or imply a
// deadline, name a product to convert into, or suggest replacing, exchanging, or modifying
// existing coverage. Time-limited features may be described ONLY as a general category worth
// checking, with the review itself as the thing that establishes the facts.
//
// The replacement red line is the sharpest one here: this audience already owns coverage, so any
// discussion of changing it is a regulated suitability/replacement matter that escalates to the
// licensed FSA immediately and is never handled by the AI.

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
// replacement. The AI answers none of these.
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
    key: 'initial_check_in',
    touch_no: 3,
    title: 'Conversation #1 — Initial Check-In',
    objective:
      'Offer the complimentary policy review to an existing policyholder and route to booking, a question, or a clean exit.',
    opening:
      "Hi {{first_name}}, I'm the automated assistant for {{fsa_name}} at {{agency_name}}. {{fsa_name}} offers existing policyholders a free 20-minute policy review. Would you like to book one, ask a question first, or not right now?",
    branches: ['book_review', 'ask_question', 'not_now', 'not_interested', 'what_is_this', 'unknown'],
    allowed:
      'Explain that the review looks at what the existing coverage provides, how long it runs, and whether the beneficiary details are current. State plainly that it obliges no change and that most reviews end with no change. Offer to book time with {{fsa_name}}.',
    prohibited:
      "Never state or imply what the recipient's policy contains, how long it runs, or that it has any particular option or deadline. Never suggest their existing coverage is inadequate. Never recommend a product, coverage amount, or premium.",
    followUp:
      "No reply needed if the timing is wrong, {{first_name}}. One word is plenty: BOOK, QUESTION, or NO. Any of the three is a good answer.",
    handoff:
      "That's about your specific policy, so it needs a licensed person rather than an assistant. I'm passing this to {{fsa_name}}, who will come back to you directly.",
    closing:
      "Understood, {{first_name}}, I'll close this out. You keep your cover exactly as it is, and nothing changes. Thanks for your time.",
    escalateOn: POLICYHOLDER_ESCALATIONS,
    exitConditions: ['appointment booked', 'advisor requested', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'life_changes',
    touch_no: 6,
    title: 'Conversation #2 — Life Changes',
    objective:
      'Surface a change since the policy was purchased that makes a review genuinely worthwhile, then offer a conversation.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Has anything changed since you took out your life policy, such as marriage, children, a move, or a change in income?",
    branches: ['marriage', 'children', 'home_move', 'income_change', 'debt_paid_off', 'retirement_planning', 'no_change', 'prefers_not_to_answer'],
    allowed:
      'Thank the client for sharing. Note in general terms that a change like that is a common prompt to check whether an existing arrangement still does what was intended, and offer to book time with {{fsa_name}}.',
    prohibited:
      'Never say a change means their coverage is now insufficient, and never quantify anything. Never propose adding, changing, or replacing coverage in response to a life event — that is a licensed conversation.',
    followUp:
      "If nothing has changed, {{first_name}}, that's a perfectly good answer. Would you like me to check back another time, or leave it here?",
    handoff:
      "Thanks for telling me. That deserves a proper conversation rather than a text thread, so I'm handing this to {{fsa_name}}, who's licensed to talk it through.",
    closing:
      "Thanks for letting me know, {{first_name}}. I'll leave it there. If something changes later on, reply here and {{fsa_name}} will pick it up.",
    escalateOn: POLICYHOLDER_ESCALATIONS,
    exitConditions: ['relevant change surfaced → offer a review', 'advisor requested', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'open_questions',
    touch_no: 10,
    title: 'Conversation #3 — Open Questions',
    objective: 'Invite the one question the policyholder has never asked, then route it to a licensed answer.',
    opening:
      "Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. Is there anything about your current life cover you have wondered about, such as how long it runs or who it pays out to?",
    branches: ['how_long_it_runs', 'who_it_pays', 'what_it_costs', 'what_happens_at_the_end', 'general_how_it_works', 'nothing_right_now'],
    allowed:
      'Explain in general terms what kinds of questions a review answers, and that the answers come from reading the actual contract rather than from assumptions. Offer to have {{fsa_name}} answer the question directly, by email or on a call.',
    prohibited:
      "Never answer a question about the recipient's own policy — the AI has no verified contract data and must not guess. Every policy-specific question escalates, without exception.",
    followUp:
      "No question is a fine answer too, {{first_name}}. If one occurs to you later, reply to this thread any time and {{fsa_name}} will answer it.",
    handoff:
      "I'd only be guessing at that, and I would rather not. I'm passing it to {{fsa_name}}, who can look at your actual policy and give you a real answer.",
    closing:
      "No problem at all, {{first_name}}. I'll close this out, and you can reply here whenever a question comes up.",
    escalateOn: POLICYHOLDER_ESCALATIONS,
    exitConditions: ['question escalated to advisor', 'appointment booked', 'not interested'],
  },
  {
    key: 'beneficiary_check',
    touch_no: 15,
    title: 'Conversation #4 — Beneficiary Check',
    objective:
      'Prompt a genuinely useful self-check that costs the client nothing, and build trust by giving value without an ask.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. A quick one worth checking: is the beneficiary named on your policy still the person you would choose today? It is the most common detail to go out of date.",
    branches: ['still_correct', 'needs_updating', 'not_sure', 'how_do_i_check', 'not_interested'],
    allowed:
      'Confirm that this is worth checking periodically and that it is the client\'s own decision entirely. Explain in general terms that beneficiary details are changed through the carrier or with the advisor\'s help. Offer to have {{fsa_name}} walk them through it.',
    prohibited:
      'Never state who the current beneficiary is, never suggest who it should be, and never take a beneficiary change instruction in this channel. Any actual change request escalates to {{fsa_name}} immediately.',
    followUp:
      "No need to reply, {{first_name}}. This one is genuinely just worth knowing. If you check and something looks off, {{fsa_name}} can help you sort it.",
    handoff:
      "A beneficiary change has to go through a licensed person and the carrier's own process, so I'm passing this to {{fsa_name}} to handle properly with you.",
    closing:
      "Glad it's in order, {{first_name}}. I'll leave it there. Reply any time if anything else comes up.",
    escalateOn: POLICYHOLDER_ESCALATIONS,
    exitConditions: ['beneficiary change requested → escalate', 'appointment booked', 'confirmed current', 'not interested'],
  },
  {
    key: 'final_invitation',
    touch_no: 18,
    title: 'Conversation #5 — Final Invitation',
    objective: 'Close the campaign respectfully, capture a future follow-up if wanted, and preserve the relationship.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant one last time. Would you like to book your free policy review, have us check back later, or close this out for now? Any of the three is fine.",
    branches: ['book_review', 'follow_up_later', 'close_campaign', 'not_interested', 'global_opt_out', 'advisor_requested'],
    allowed:
      'Offer the three options plainly. Honor a global opt-out by routing it to suppression handling. Thank the client and make clear their coverage is unaffected either way.',
    prohibited:
      'Never pressure, use a final-chance framing, or imply risk from declining. Never recommend a product. Never ask the client to reconsider more than once.',
    followUp:
      "I'll take the silence as a no, {{first_name}}, and close this out. Nothing further needed, and thank you for your time.",
    handoff:
      "Of course, I'll pass you to {{fsa_name}} now so you can speak with a licensed person directly.",
    closing:
      "Closed out, {{first_name}}. Your cover carries on exactly as it is. If a question ever comes up, reply here and {{fsa_name}} will pick it straight up.",
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
// here is auto-dispatched. They are conversation openers, not scripts to be read aloud.
export const ADVISOR_SCRIPTS: AdvisorScript[] = [
  {
    touch_no: 7,
    key: 'policy_review_invitation',
    title: 'Advisor Call #1 — Policy Review Invitation',
    script:
      "Hi {{first_name}}, this is {{fsa_name}} with {{agency_name}}. I work alongside your Farmers agent on the life insurance side. I am calling about the policy you already hold with us, and specifically to offer a complimentary review of it. To be clear about what that means: I would go through what your coverage actually provides, how long it runs, and whether the beneficiary details are still right. I am not calling to move you into anything different, and most of these end with me confirming things are in order. Would twenty minutes be useful?",
    goals: [
      'make the existing policy visible again',
      'state explicitly that no change is being proposed',
      'confirm the beneficiary details are current',
      'book a review only where the client wants one',
    ],
  },
  {
    touch_no: 13,
    key: 'final_personal_invitation',
    title: 'Advisor Call #2 — Final Personal Invitation',
    script:
      "Hi {{first_name}}, {{fsa_name}} here with {{agency_name}}. I wanted to reach out personally once more before I close this review invitation. If you are happy with your coverage as it stands, that is a perfectly good place to be and I will leave it there. If you have ever wondered what exactly your policy does or who it pays out to, that is a twenty-minute conversation and it costs you nothing. Either way, thank you for keeping your coverage with us.",
    goals: [
      'give the client a dignified way to decline',
      'leave one concrete, low-cost reason to say yes',
      'close the invitation without pressure',
      'preserve the policyholder relationship for future service',
    ],
  },
]

export function advisorScriptForTouch(touchNo: number): AdvisorScript | null {
  return ADVISOR_SCRIPTS.find((s) => s.touch_no === touchNo) ?? null
}
