// src/lib/cross-sell-life/playbooks.ts
// The seven Cross-Sell Life AI conversation playbooks (spec §9) as PURE, versioned data. Each
// playbook is an internal script the AI conversation engine grounds on; every substantive /
// individualized request routes to advisor escalation (conversation.ts / §4.2 red-line). Content
// is verbatim intent from §9 — engineering does not rewrite it. The AI-conversation touch (§6)
// sends the playbook opening as an APPROVED comm_template (category cross_sell_life_ai); the
// tree/escalation metadata below drives classification and handoff and is surfaced in the
// Conversation Center (§ Management Interface). AI must clearly identify as an automated assistant
// (opening lines do) and must NEVER recommend a product, carrier, coverage amount, premium,
// replacement, funding method, or underwriting outcome (§4.2).

export interface Playbook {
  key: string
  /** The §6 touch that fires this playbook. */
  touch_no: number
  title: string
  objective: string
  /** The opening line (seeded as an approved comm_template, category cross_sell_life_ai). */
  opening: string
  /** Intent branches the AI may explore with GENERAL educational information only. */
  branches: string[]
  /** What the AI is allowed to say/do (green zone). */
  allowed: string
  /** Prohibited behavior (red line, §4.2/§14). */
  prohibited: string
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
    objective: 'Offer an existing client a complimentary life protection review; route to question, schedule, info, or exit.',
    opening:
      'Hi {{first_name}}, I am the automated assistant for {{fsa_name}} at {{agency_name}}. Because you are an existing client, we wanted to offer you a complimentary life insurance protection review. Are you mainly interested in asking a question, scheduling a review, or receiving general information?',
    branches: ['question', 'schedule', 'general_information', 'not_interested', 'follow_up_later', 'existing_coverage', 'unknown'],
    allowed:
      'I can provide general educational information and help schedule time with {{fsa_name}}. I cannot recommend a specific policy, coverage amount, carrier, or premium.',
    prohibited: 'Never recommend a product, coverage amount, carrier, premium, or replacement. Never make a suitability determination.',
    escalateOn: ['recommendation', 'pricing', 'quote', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'urgency', 'dissatisfaction', 'unknown'],
    exitConditions: ['appointment booked', 'not interested', 'future follow-up requested', 'general information sent'],
  },
  {
    key: 'life_change_discovery',
    touch_no: 9,
    title: 'AI Playbook 2 — Life-Change Discovery',
    objective: 'Surface qualifying life changes; offer a personal conversation. Never quantify coverage.',
    opening:
      'Since you became a client, have there been any major changes such as marriage, children, a home purchase, a job change, business ownership, retirement planning, or new financial responsibilities?',
    branches: ['marriage', 'children', 'home_purchase', 'job_change', 'business_ownership', 'retirement', 'no_change', 'prefers_not_to_answer'],
    allowed:
      'Thank you for sharing that. Changes like {{life_event}} may affect the financial responsibilities a household wants to review. I can help schedule a complimentary conversation with {{fsa_name}} so your circumstances can be discussed personally.',
    prohibited: 'Do not calculate coverage or recommend a product.',
    escalateOn: ['recommendation', 'quote', 'pricing', 'coverage_amount', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'unknown'],
    exitConditions: ['relevant change surfaced → offer a review', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'protection_discovery',
    touch_no: 13,
    title: 'AI Playbook 3 — Protection Discovery',
    objective: 'Identify the priority protection area; hand to a licensed advisor for evaluation.',
    opening:
      'When people review life insurance, they often consider income, housing, debt, dependents, education goals, existing coverage, and other long-term responsibilities. Which area is most important to you?',
    branches: ['income_replacement', 'mortgage', 'debt', 'children', 'education', 'final_expenses', 'business', 'existing_coverage', 'unsure'],
    allowed:
      'That is an important area to consider. A licensed advisor can help you evaluate it in the context of your complete situation. Would you like to schedule a call, a virtual meeting, or request a future follow-up?',
    prohibited: 'Do not estimate a coverage amount or recommend a product for any area named.',
    escalateOn: ['recommendation', 'quote', 'pricing', 'coverage_amount', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'unknown'],
    exitConditions: ['schedule requested', 'future follow-up requested', 'not interested'],
  },
  {
    key: 'existing_coverage_review',
    touch_no: 18,
    title: 'AI Playbook 4 — Existing Coverage Review',
    objective: 'Understand what coverage exists; educate on employer-coverage questions. Never advise replacement.',
    opening: 'Do you currently have life insurance through work, an individually owned policy, both, or are you unsure?',
    branches: ['employer_coverage', 'individual_policy', 'both', 'no_coverage', 'unsure'],
    allowed:
      'Employer-provided life insurance can be valuable, but it may be helpful to understand the amount, portability, continuation rules, and what happens after a job change or retirement. {{fsa_name}} can help you review the questions to consider.',
    prohibited:
      'Replacement restriction: NEVER recommend canceling, replacing, reducing, exchanging, or modifying existing coverage. Any replacement-related discussion escalates to the advisor immediately.',
    escalateOn: ['replacement', 'recommendation', 'quote', 'pricing', 'coverage_amount', 'health', 'underwriting', 'tax', 'legal', 'unknown'],
    exitConditions: ['schedule requested', 'replacement topic → escalate', 'not interested'],
  },
  {
    key: 'objection_handling',
    touch_no: 23,
    title: 'AI Playbook 5 — Objection Handling',
    objective: 'Address common objections with general education only; escalate anything substantive.',
    opening: 'Hi {{first_name}}, a lot of people put a review off for very understandable reasons. Is there anything specific holding you back that I can help clarify?',
    branches: ['cost', 'timing', 'already_covered', 'work_coverage', 'need_to_think', 'too_busy', 'health_concern', 'not_interested'],
    allowed:
      'That is understandable. Life insurance pricing varies based on several factors, and I cannot estimate pricing or recommend an option. There is no obligation to decide during the first conversation. A licensed advisor can review your goals and whether there are options worth considering within your budget.',
    prohibited:
      'Do not estimate pricing. Do not ask for or accept medical details in this channel — a health concern escalates to the advisor. Do not recommend a product.',
    escalateOn: ['health_concern', 'recommendation', 'quote', 'pricing', 'coverage_amount', 'underwriting', 'replacement', 'tax', 'legal', 'unknown'],
    exitConditions: ['objection clarified → offer a review', 'health/substantive → escalate', 'not interested'],
  },
  {
    key: 'scheduling_next_steps',
    touch_no: 29,
    title: 'AI Playbook 6 — Scheduling and Next Steps',
    objective: 'Book a complimentary review; collect only non-sensitive scheduling details.',
    opening: 'I can help you schedule a complimentary life insurance protection review. Would you prefer a phone call, virtual meeting, or in-person appointment if available?',
    branches: ['phone', 'virtual', 'in_person', 'not_now', 'future_follow_up'],
    allowed:
      'Collect only: appointment type, preferred date, preferred time, timezone, confirmed email, confirmed telephone number, accessibility/communication accommodations, and a general non-sensitive note. On selection: confirm date/time/timezone/advisor and note confirmation channels + reschedule/cancel link.',
    prohibited: 'Do NOT collect medical information. Do not recommend a product or coverage amount.',
    escalateOn: ['recommendation', 'quote', 'pricing', 'coverage_amount', 'health', 'underwriting', 'replacement', 'tax', 'legal', 'unknown'],
    exitConditions: ['appointment booked', 'future follow-up requested', 'not interested'],
  },
  {
    key: 'respectful_close',
    touch_no: 35,
    title: 'AI Playbook 7 — Respectful Close or Future Follow-Up',
    objective: 'Close the campaign respectfully or schedule a future follow-up; preserve the relationship.',
    opening:
      'Thank you for your time, {{first_name}}. Would you like us to schedule a review, check back at a later date, or close this life insurance follow-up for now?',
    branches: ['schedule_appointment', 'follow_up_30', 'follow_up_60', 'follow_up_90', 'custom_follow_up', 'close_campaign', 'not_interested', 'global_opt_out', 'advisor_requested'],
    allowed:
      'Understood. We will close this Cross-Sell Life follow-up. Thank you for being a client of {{agency_name}}. You may contact us in the future whenever you need assistance.',
    prohibited: 'Do not pressure. Do not recommend a product. Honor a global opt-out request by routing it to suppression handling.',
    escalateOn: ['advisor_requested', 'recommendation', 'quote', 'complaint', 'unknown'],
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
