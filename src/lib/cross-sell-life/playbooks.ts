// src/lib/cross-sell-life/playbooks.ts
// The seven Cross-Sell Life AI conversation playbooks as PURE, versioned data. Each playbook is
// an internal script the AI conversation engine grounds on; every substantive/individualized
// request routes to advisor escalation (conversation.ts / §4.2 red-line). The AI-conversation
// touch (§6) sends the playbook `opening` as a comm_template (category cross_sell_life_ai,
// migration 100); the branch/escalation metadata drives classification and handoff and is
// surfaced in the Conversation Center and the campaign detail view.
//
// The field shape is shared with src/lib/pipeline-winback/playbooks.ts so both campaigns present
// one playbook model rather than two divergent ones (CLAUDE.md §6).
//
// AUDIENCE: existing agency clients who did NOT ask to be contacted about life insurance. The
// agency relationship outranks any conversion. Every playbook gives an easy, dignified exit and
// never pressures.
//
// COMPLIANCE: the AI ALWAYS identifies itself as an automated assistant (every `opening` does,
// and dispatcher.ts appends the TRAIGA AI-disclosure footer to every SMS). It may educate,
// qualify, invite, schedule, remind, follow up, and route. It may NEVER recommend a product,
// carrier, coverage amount, premium, or replacement, quote a rate, make a suitability/
// best-interest determination, or assert what coverage the recipient already holds (ADR-020).

export interface Playbook {
  key: string
  /** The §6 touch that fires this playbook. */
  touch_no: number
  title: string
  objective: string
  /** The opening line (seeded as a comm_template, category cross_sell_life_ai). */
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
  /** Intents that end the AI's turn and hand to the advisor (mirrors XSELL_ESCALATION_INTENTS). */
  escalateOn: string[]
  /** Conditions under which the playbook closes the conversation (feeds the §15 state machine). */
  exitConditions: string[]
}

export const PLAYBOOKS: Playbook[] = [
  {
    key: 'existing_client_welcome',
    touch_no: 3,
    title: 'AI Playbook 1 — Existing Client Welcome',
    objective:
      'Introduce the FSA as someone who works alongside the client existing Farmers agent, and find out which of question / booking / information is wanted.',
    opening:
      "Hi {{first_name}}, I'm the automated assistant for {{fsa_name}} at {{agency_name}}. As an existing client you're offered a complimentary life insurance review. Would a question, a booking, or general info help most?",
    branches: ['question', 'schedule', 'general_information', 'not_interested', 'follow_up_later', 'existing_coverage', 'unknown'],
    allowed:
      'Explain that {{fsa_name}} handles life insurance and financial services alongside the client Farmers agent. Give general educational information and offer to book time. Make clear there is no obligation and no effect on their other policies.',
    prohibited:
      'Never recommend a product, coverage amount, carrier, or premium. Never make a suitability determination. Never imply their existing agency relationship depends on engaging with this.',
    followUp:
      "No reply needed if this isn't relevant, {{first_name}}. If it's easier, just send one word: INFO, BOOK, or NO. Any of them is a good answer.",
    handoff:
      "That's one for a licensed person rather than an assistant. I'm passing you to {{fsa_name}} now, and they'll come back to you directly.",
    closing:
      "Understood, {{first_name}}, I'll close this out. It won't affect anything else with {{agency_name}}. Thanks for your time.",
    escalateOn: ['recommendation', 'pricing', 'quote', 'coverage_amount', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'urgency', 'dissatisfaction', 'complaint', 'unknown'],
    exitConditions: ['appointment booked', 'advisor requested', 'not interested', 'future follow-up requested', 'general information sent'],
  },
  {
    key: 'life_change_discovery',
    touch_no: 9,
    title: 'AI Playbook 2 — Life-Change Discovery',
    objective: 'Surface a qualifying life change that makes a review genuinely relevant. Never quantify coverage.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Has anything changed for you lately, such as a home purchase, a new child, a job move, or starting a business? Those are usually what make this worth a look.",
    branches: ['marriage', 'children', 'home_purchase', 'job_change', 'business_ownership', 'retirement', 'new_debt', 'no_change', 'prefers_not_to_answer'],
    allowed:
      'Thank the client for sharing. Note in general terms that a change like that often shifts what a household wants to protect, and offer to book time with {{fsa_name}} so it can be discussed personally.',
    prohibited:
      'Never calculate or suggest a coverage amount in response to a life event. Never tell a client an event means they need coverage. Do not collect medical details.',
    followUp:
      "If nothing has changed, {{first_name}}, that's genuinely a good answer and worth knowing. Want me to check back another time, or leave it here?",
    handoff:
      "Thanks for telling me. That's worth a proper conversation rather than a text thread, so I'm handing this to {{fsa_name}}, who's licensed to talk it through.",
    closing:
      "Thanks for letting me know, {{first_name}}. I'll leave it there. If something changes later, reply here and {{fsa_name}} will pick it up.",
    escalateOn: ['recommendation', 'quote', 'pricing', 'coverage_amount', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['relevant change surfaced → offer a review', 'advisor requested', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'protection_discovery',
    touch_no: 13,
    title: 'AI Playbook 3 — Priority Discovery',
    objective: 'Identify the one thing the client would most want protected, then hand to a licensed advisor to evaluate it.',
    opening:
      "Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. If you were to look at this at all, what would you most want protected: your income, the mortgage, your children, or something else entirely?",
    branches: ['income_replacement', 'mortgage', 'debt', 'children', 'education', 'final_expenses', 'business', 'existing_coverage', 'unsure'],
    allowed:
      'Reflect the priority back and confirm it is a common one. Explain that a licensed advisor can evaluate it against their full situation, and offer a call, a virtual meeting, or a future follow-up.',
    prohibited:
      'Never estimate a coverage amount for the named priority. Never rank priorities for the client or suggest one matters more than another.',
    followUp:
      "No need to have an answer ready, {{first_name}}. \"Not sure\" is where most people start, and it's a perfectly good place to begin a conversation.",
    handoff:
      "That deserves a real answer from a licensed person. I'm passing this to {{fsa_name}} so they can look at it properly with you.",
    closing:
      "Thanks for thinking it over, {{first_name}}. I'll close this out for now, and you can reply here any time you'd like to revisit it.",
    escalateOn: ['recommendation', 'quote', 'pricing', 'coverage_amount', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['schedule requested', 'advisor requested', 'future follow-up requested', 'not interested'],
  },
  {
    key: 'existing_coverage_review',
    touch_no: 18,
    title: 'AI Playbook 4 — Existing Coverage Check',
    objective: 'Understand what coverage exists and educate on the employer-coverage questions. Never advise replacement.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Do you currently have any life coverage through work, a policy of your own, both, or are you not sure? No wrong answer, it just tells us where to start.",
    branches: ['employer_coverage', 'individual_policy', 'both', 'no_coverage', 'unsure'],
    allowed:
      'Explain that employer coverage is a real benefit, and that the useful questions are the amount, whether it is portable, whether it continues after a job change or into retirement, and whether any part is individually owned. Offer to have {{fsa_name}} walk through what to look for.',
    prohibited:
      'REPLACEMENT RESTRICTION: never recommend cancelling, replacing, reducing, exchanging, or modifying existing coverage, and never suggest existing coverage is inadequate. Any replacement topic escalates immediately.',
    followUp:
      "Not sure is the most common answer, {{first_name}}, and it's an easy one to fix. Your benefits portal usually has it in about five minutes if you ever want to check.",
    handoff:
      "Anything about existing coverage needs a licensed person, so I'm handing this to {{fsa_name}} rather than answering it myself.",
    closing:
      "Good to know, {{first_name}}. I'll leave it there. If you ever want a second pair of eyes on what you already have, reply here.",
    escalateOn: ['replacement', 'recommendation', 'quote', 'pricing', 'coverage_amount', 'health', 'underwriting', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['schedule requested', 'replacement topic → escalate', 'advisor requested', 'not interested'],
  },
  {
    key: 'objection_handling',
    touch_no: 23,
    title: 'AI Playbook 5 — Objection Handling',
    objective: 'Name the real blocker, reduce it with general education only, and escalate anything substantive.',
    opening:
      "Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. If you've been leaving this one alone, there's usually a specific reason. Is there something particular I can help clear up?",
    branches: ['cost', 'timing', 'already_covered', 'work_coverage', 'need_to_think', 'too_busy', 'health_concern', 'trust', 'not_interested'],
    allowed:
      'Validate the objection. Explain that cost varies with the type and amount of coverage, age, health, and underwriting, and that no figure can be given here. Note there is no obligation to decide in a first conversation.',
    prohibited:
      'Never estimate pricing. Never request or accept medical details in this channel — a health concern escalates to the advisor. Never recommend a product or tell a client their current position is wrong.',
    followUp:
      "Fair enough if you'd rather not get into it, {{first_name}}. If it's easier, I can have {{fsa_name}} answer the one question by email so no meeting is involved.",
    handoff:
      "I want to be careful with that one, so I'm passing it to {{fsa_name}}, who is licensed to answer it properly.",
    closing:
      "That's completely fair, {{first_name}}. I'll close this out. If the reason ever changes, you know where we are.",
    escalateOn: ['health_concern', 'recommendation', 'quote', 'pricing', 'coverage_amount', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['objection clarified → offer a review', 'health/substantive → escalate', 'advisor requested', 'not interested'],
  },
  {
    key: 'scheduling_next_steps',
    touch_no: 29,
    title: 'AI Playbook 6 — Scheduling and Next Steps',
    objective: 'Book the complimentary review, collecting only non-sensitive scheduling details.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. I can set up a complimentary protection review whenever suits you. Would you prefer a phone call, a video meeting, or to meet in person?",
    branches: ['phone', 'virtual', 'in_person', 'email_answer_first', 'not_now', 'future_follow_up'],
    allowed:
      'Collect only: appointment type, preferred date, preferred time, timezone, confirmed email, confirmed phone, accessibility or communication accommodations, and a general non-sensitive note. On booking, confirm date, time, timezone, and who they are meeting, and note the reschedule and cancel options.',
    prohibited:
      'Never collect medical, financial-account, or securities information. Never promise an outcome, a price, or an approval. Never recommend a product or coverage amount.',
    followUp:
      "No pressure at all, {{first_name}}. If a meeting is more than you want, reply with your question instead and I'll have {{fsa_name}} answer it directly.",
    handoff:
      "I'll hand you to {{fsa_name}} from here, since that part is theirs to answer rather than mine.",
    closing:
      "All set, {{first_name}}. A confirmation is on its way, and you can reschedule from that message any time. Thanks for making the time.",
    escalateOn: ['recommendation', 'quote', 'pricing', 'coverage_amount', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['appointment booked', 'advisor requested', 'future follow-up requested', 'not interested'],
  },
  {
    key: 'respectful_close',
    touch_no: 35,
    title: 'AI Playbook 7 — Respectful Close or Future Follow-Up',
    objective: 'Close the campaign warmly or capture a future follow-up, protecting the agency relationship above all.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant one last time. Would you like to book a review, have us check back later, or close this out for now? Any of the three is completely fine.",
    branches: ['schedule_appointment', 'follow_up_30', 'follow_up_60', 'follow_up_90', 'custom_follow_up', 'close_campaign', 'not_interested', 'global_opt_out', 'advisor_requested'],
    allowed:
      'Offer the three options plainly. Honor a global opt-out by routing it to suppression handling. Thank the client for their business with {{agency_name}} and make clear this does not affect their other policies.',
    prohibited:
      'Never pressure, guilt, or use a final-chance framing. Never recommend a product. Never ask the client to reconsider more than once.',
    followUp:
      "I'll take the silence as a no, {{first_name}}, and close this out. Nothing further needed from you, and thank you for your time.",
    closing:
      "Closed out, {{first_name}}. Thank you for being a client of {{agency_name}} — that's the part that matters. If a question ever comes up, reply here and {{fsa_name}} will pick it up.",
    handoff:
      "Of course, I'll pass you to {{fsa_name}} now so you can speak with a licensed person directly.",
    escalateOn: ['advisor_requested', 'recommendation', 'quote', 'pricing', 'complaint', 'unknown'],
    exitConditions: ['appointment booked', 'future follow-up scheduled', 'campaign closed', 'advisor requested', 'global opt-out requested'],
  },
]

/** Look up a playbook by its scheduled touch number. */
export function playbookForTouch(touchNo: number): Playbook | null {
  return PLAYBOOKS.find((p) => p.touch_no === touchNo) ?? null
}

export function playbookByKey(key: string): Playbook | null {
  return PLAYBOOKS.find((p) => p.key === key) ?? null
}
