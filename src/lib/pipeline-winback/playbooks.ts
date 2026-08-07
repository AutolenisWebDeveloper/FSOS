// src/lib/pipeline-winback/playbooks.ts
// The six Win-Back AI conversation playbooks as PURE, versioned data. Each playbook is an
// internal script the AI conversation engine grounds on; every substantive/individualized
// question routes to advisor escalation (conversation.ts / §4.2 red-line). The AI-conversation
// touch (§7) sends the playbook's `opening` as an APPROVED comm_template (category
// pipeline_winback_ai, migration 099); the branch/escalation metadata below drives
// classification and handoff. Kept as data (not prose in code) so the playbook set is
// auditable in one place and is surfaced in the campaign detail view (§12).
//
// The field shape is aligned with src/lib/cross-sell-life/playbooks.ts so both campaigns
// present one playbook model rather than two divergent ones (CLAUDE.md §6).
//
// COMPLIANCE: the AI ALWAYS identifies itself as an automated assistant (every `opening`
// does, and dispatcher.ts appends the STOP opt-out footer to every SMS). It may
// educate, qualify, invite, schedule, remind, follow up, and route. It may NEVER recommend
// a product, carrier, coverage amount, premium, or replacement, quote a rate, make a
// suitability/best-interest determination, or assert a specific claim about the recipient's
// own policy or coverage (§4.1/§4.2, ADR-020).

export interface Playbook {
  key: string
  /** The §7 touch that fires this playbook. */
  touch_no: number
  title: string
  /** What this playbook is trying to accomplish for the client. */
  objective: string
  /** The opening line (seeded as a comm_template, category pipeline_winback_ai). */
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
  /** Intents that end the AI's turn and hand to the advisor (mirrors WINBACK_ESCALATION_INTENTS). */
  escalateOn: string[]
  /** Conditions under which the playbook closes the conversation (feeds the §10 state machine). */
  exitConditions: string[]
}

// The handoff wording is deliberately identical in shape across playbooks: name the human,
// say why the AI is stepping aside, and set a concrete expectation. Never "I'll have someone
// look into your options" (implies a recommendation is coming) — only "a licensed person will
// answer this".
export const PLAYBOOKS: Playbook[] = [
  {
    key: 'reconnect',
    touch_no: 3,
    title: 'Playbook #1 — Reconnect',
    objective:
      'Reopen a stalled conversation without pressure, and get a clear yes / not-now / no so the timeline can respond to reality.',
    opening:
      "Hi {{first_name}}, I'm the automated assistant for {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. You looked into life insurance with us a while back. Pick it back up, or close it out?",
    branches: ['still_interested', 'not_now', 'not_interested', 'what_stopped_them', 'process_question', 'unknown'],
    allowed:
      'Acknowledge the gap warmly and without guilt. Ask what got in the way. Offer general information about how a complimentary review works, and offer to book time with {{fsa_name}}.',
    prohibited:
      'Never imply the client did something wrong by going quiet. Never recommend a product, coverage amount, premium, or carrier. Never reference a prior quote figure.',
    followUp:
      "No rush at all, {{first_name}}, a one-word reply is plenty. \"Yes\" and I'll set something up, \"later\" and I'll check back, or \"no\" and I'll close it out for good.",
    handoff:
      "That's a good question, and I'd rather you get it from a person than from me. I'm passing this to {{fsa_name}}, who is licensed to answer it properly. Expect to hear back shortly.",
    closing:
      "Understood, {{first_name}}, I'll close this out. Thank you for being straight with me. If it ever comes back around, just reply here and {{fsa_name}} will pick it up.",
    escalateOn: ['quote', 'pricing', 'coverage_question', 'coverage_amount', 'existing_coverage', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['appointment booked', 'advisor requested', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'life_changes_discovery',
    touch_no: 6,
    title: 'Playbook #2 — Life Changes Discovery',
    objective:
      'Surface a qualifying life change that makes a review genuinely relevant right now, then offer a conversation about it.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Has anything big changed since you last spoke with us, such as marriage, a new home, a growing family, or a career move?",
    branches: ['marriage', 'children', 'home_purchase', 'job_change', 'business_ownership', 'retirement', 'debt_paid_off', 'no_change', 'prefers_not_to_answer'],
    allowed:
      'Thank the client for sharing. Note in general terms that a change like that often shifts what a household wants to protect, and offer to book time with {{fsa_name}} so it can be discussed personally.',
    prohibited:
      'Never calculate or suggest a coverage amount in response to a life event. Never say a change means they need more coverage. Do not collect medical details.',
    followUp:
      "No problem if nothing has changed, {{first_name}}, that's a useful answer too. Would you like me to check back another time, or close this out?",
    handoff:
      "Thanks for telling me that. It deserves a real conversation rather than a text thread, so I'm handing this to {{fsa_name}}, who is licensed to talk it through with you.",
    closing:
      "Thanks for letting me know, {{first_name}}. I'll leave it there. If anything changes down the line, reply here and {{fsa_name}} will pick it straight back up.",
    escalateOn: ['quote', 'pricing', 'coverage_question', 'coverage_amount', 'existing_coverage', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['a relevant change surfaces → offer a review', 'advisor requested', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'objection_handling',
    touch_no: 11,
    title: 'Playbook #3 — Objection Handling',
    objective: 'Name the specific blocker, reduce it with general education only, and escalate anything substantive.',
    opening:
      "Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. Most people who pause on this have one specific reason. Is there something particular holding you back that I can help clear up?",
    branches: ['cost', 'timing', 'work_coverage', 'already_covered', 'health_concern', 'need_to_think', 'too_busy', 'trust', 'not_interested'],
    allowed:
      'Validate the objection honestly. Explain in general terms that cost depends on the type and amount of coverage, age, health, and underwriting, and that no figure can be given here. Note there is no obligation to decide during a first conversation.',
    prohibited:
      'Never estimate or imply a price, rate, or premium. Never ask for or accept medical details in this channel — a health concern escalates immediately. Never tell the client their existing coverage is insufficient.',
    followUp:
      "Totally fine if you would rather not get into it, {{first_name}}. If it helps, I can have {{fsa_name}} answer just the one question by email so there's no meeting involved.",
    handoff:
      "I want to be careful here, that one needs a licensed person, not an assistant. I'm passing it to {{fsa_name}}, who can give you a proper answer.",
    closing:
      "That's fair, {{first_name}}. I'll stop here and close this out. If the reason changes, you know where to find us.",
    escalateOn: ['health_concern', 'quote', 'pricing', 'coverage_question', 'coverage_amount', 'existing_coverage', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['objection clarified → offer a review', 'health/substantive → escalate', 'advisor requested', 'not interested'],
  },
  {
    key: 'education',
    touch_no: 16,
    title: 'Playbook #4 — Plain-Terms Education',
    objective: 'Lower the perceived complexity of the topic so a review feels worth twenty minutes.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Would it help if I explained, in plain terms, how people usually think about life insurance and when a review is worth doing?",
    branches: ['how_it_works', 'policy_types_general', 'why_people_buy', 'when_to_review', 'what_a_review_involves', 'not_interested'],
    allowed:
      'Explain at a category level only: what life insurance is generally for, that policy types differ, and the factors people commonly weigh (income, debt, final expenses, education, time). Describe what a complimentary review involves.',
    prohibited:
      'Never say which type of policy suits this client, never compare products as better or worse for them, and never give a figure. Category-level education only.',
    followUp:
      "No worries either way, {{first_name}}. If you would rather skip the explanation and just ask {{fsa_name}} something directly, I can arrange that instead.",
    handoff:
      "That goes past general information, so I'm handing it to {{fsa_name}}, who is licensed to answer it for your particular situation.",
    closing:
      "Happy to have helped, {{first_name}}. I'll leave it there for now, reply any time if you'd like to talk it through with {{fsa_name}}.",
    escalateOn: ['quote', 'pricing', 'coverage_question', 'coverage_amount', 'existing_coverage', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['client wants a personalized discussion → offer advisor', 'advisor requested', 'not interested'],
  },
  {
    key: 'scheduling',
    touch_no: 21,
    title: 'Playbook #5 — Scheduling and Next Steps',
    objective: 'Convert stated interest into a booked appointment, collecting only non-sensitive scheduling details.',
    opening:
      "Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. Would you like to set up a short call or video meeting with {{fsa_name}}, or would you rather I pass along a few general answers by text first?",
    branches: ['phone', 'virtual', 'in_person', 'email_answer_first', 'not_now', 'future_follow_up'],
    allowed:
      'Collect only: appointment type, preferred date, preferred time, timezone, confirmed email, confirmed phone, accessibility or communication accommodations, and a general non-sensitive note. On booking, confirm date, time, timezone, and who they are meeting, and note the reschedule and cancel options.',
    prohibited:
      'Never collect medical, financial-account, or securities information. Never promise an outcome, a price, or an approval. Never recommend a product or coverage amount.',
    followUp:
      "No pressure, {{first_name}}, if a meeting feels like too much, reply with your question instead and I'll get {{fsa_name}} to answer it directly.",
    handoff:
      "I'll pass this to {{fsa_name}} to take from here, that part is theirs to answer, not mine.",
    closing:
      "All set, {{first_name}}. You'll get a confirmation shortly, and you can reschedule from that message any time. Thanks for making the time.",
    escalateOn: ['quote', 'pricing', 'application', 'coverage_question', 'coverage_amount', 'existing_coverage', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'complaint', 'unknown'],
    exitConditions: ['appointment booked', 'advisor requested', 'future follow-up requested', 'not interested'],
  },
  {
    key: 'final_outreach',
    touch_no: 24,
    title: 'Playbook #6 — Respectful Final Outreach',
    objective: 'End the campaign on good terms, capture a future follow-up if wanted, and preserve the relationship.',
    opening:
      "Hi {{first_name}}, {{fsa_name}}'s automated assistant one last time. Would you like us to check back with you later on, or should we close out this follow-up for now? Either is completely fine.",
    branches: ['schedule_appointment', 'follow_up_later', 'close_campaign', 'not_interested', 'global_opt_out', 'advisor_requested'],
    allowed:
      'Offer three clear options: book time, be contacted at a stated later date, or close the follow-up. Honor a global opt-out request by routing it to suppression handling. Thank the client sincerely.',
    prohibited:
      'Never apply pressure, guilt, urgency, or a final-chance framing. Never recommend a product. Never ask the client to reconsider more than once.',
    followUp:
      "I'll take the silence as a no, {{first_name}}, and close this out, no need to reply. Thank you for your time.",
    handoff:
      "Of course, I'm passing you to {{fsa_name}} now so you can speak with a licensed person directly.",
    closing:
      "Closed out, {{first_name}}. Thank you genuinely for your time. If things change, reply to this number and {{fsa_name}} will pick it straight back up, no starting over.",
    escalateOn: ['advisor_requested', 'quote', 'pricing', 'coverage_question', 'complaint', 'unknown'],
    exitConditions: ['future follow-up scheduled', 'campaign ended', 'advisor requested', 'global opt-out requested'],
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
  key: string
  /** The §7 touch that generates this advisor task. */
  touch_no: number
  title: string
  /** The script the advisor works from (phone/voicemail/email). */
  script: string
  goals: string[]
}

// The two Advisor Outreach touches. Each generates a work_task + a tracked advisor touch (§9a);
// completion requires a LOGGED outreach attempt, and a missed task never stalls the timeline
// (advisor.campaignProceedsPastAdvisor default 'proceed'). These are HUMAN scripts — the FSA
// speaks them; nothing here is auto-dispatched.
export const ADVISOR_SCRIPTS: AdvisorScript[] = [
  {
    key: 'relationship_reconnect',
    touch_no: 8,
    title: 'Advisor Script #1 — Relationship Reconnect',
    script:
      "Hi {{first_name}}, this is {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. I handle the life and financial services side for the agency's clients. We talked a while back about life insurance and then things went quiet, which honestly happens with most people. I'm not calling to sell you anything today. I just wanted to hear whether anything has changed on your end, and to make myself available if there's a question you never got answered. If the timing still isn't right, tell me and I'll leave you alone about it.",
    goals: [
      'reconnect as a person, not a pipeline follow-up',
      'find out what actually stopped the process',
      'answer one real question',
      'book a review only if the client wants one',
    ],
  },
  {
    key: 'final_personal_follow_up',
    touch_no: 14,
    title: 'Advisor Script #2 — Final Personal Follow-Up',
    script:
      "Hi {{first_name}}, it's {{fsa_name}}. I wanted to reach out personally once before I close your follow-up file. If life insurance isn't a priority right now, that's a completely reasonable place to be and I'd rather know than keep checking in. If it is still on your mind, I'm glad to talk it through whenever suits you, no obligation either way. Thank you for your time, and all the best to you and your family.",
    goals: [
      'close the campaign professionally and warmly',
      'give the client an easy, dignified exit',
      'leave the door genuinely open for future contact',
      'preserve the referring agency relationship',
    ],
  },
]

export function advisorScriptForTouch(touchNo: number): AdvisorScript | null {
  return ADVISOR_SCRIPTS.find((s) => s.touch_no === touchNo) ?? null
}

export interface EventTrigger {
  key: string
  title: string
  body: string
}

// Event-driven SMS triggers — fired on events, NOT on the Day-based schedule, and do not count
// toward the 24 proactive touches. Shown for completeness in the campaign detail. No opt-out text:
// dispatcher.ts appends the STOP opt-out footer to every SMS.
export const EVENT_DRIVEN_SMS: EventTrigger[] = [
  {
    key: 'appointment_reminder',
    title: 'Appointment Reminder',
    body: 'Hi {{first_name}}, a quick reminder about your meeting with {{fsa_name}} on {{appointment_time}}. Nothing to prepare. If you need a different time, just reply here.',
  },
  {
    key: 'missed_appointment',
    title: 'Missed Appointment',
    body: "Hi {{first_name}}, we missed each other today. No problem at all. Reply with a day that suits you better and {{fsa_name}} will work around it.",
  },
  {
    key: 'ai_follow_up',
    title: 'AI Follow-Up',
    body: "Thanks for getting back to me, {{first_name}}. I'm {{fsa_name}}'s automated assistant, so I can answer general questions and set up a time with {{fsa_name}}. Anything specific to your situation, I'll pass straight to them.",
  },
  {
    key: 'information_ready',
    title: 'Information Ready',
    body: "Hi {{first_name}}, {{fsa_name}} has put together the general information you asked about. Reply CALL if you'd like to go through it together, or reply with any question and they'll answer it.",
  },
  {
    key: 'future_follow_up',
    title: 'Future Follow-Up',
    body: 'Hi {{first_name}}, you asked us to check back around now. Is this a better moment to look at life insurance, or would you rather I close it out? Either answer works.',
  },
]
