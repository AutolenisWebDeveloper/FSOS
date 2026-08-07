// src/lib/cross-sell-life/advisor-scripts.ts
// The four Cross-Sell Life advisor-outreach scripts as PURE, versioned data. Advisor touches are
// HUMAN tasks, never automated impersonated calls (§10) — the tick creates a work_task plus an
// xsell_life_advisor_touches row carrying this script as the suggested opener, and a real LOGGED
// outreach attempt is what fulfils the touch (advisor.ts / §9a). Tokens are repo-native snake_case
// so they resolve in the task view.
//
// These are spoken by the FSA to an EXISTING agency client who did not ask to be called about life
// insurance. The scripts therefore open by naming the relationship, state the reason for the call
// immediately, and offer an easy exit before asking for anything. They are conversation openers,
// not scripts to be read aloud verbatim.
//
// COMPLIANCE: green-zone only — the FSA may educate, ask, invite, and schedule. Nothing here
// recommends a product, carrier, coverage amount, premium, or replacement, asserts what the client
// already owns, or makes a suitability determination.

export interface AdvisorScript {
  /** The §6 advisor touch this fulfils. */
  touch_no: number
  key: string
  title: string
  script: string
  goals: string[]
}

export const ADVISOR_SCRIPTS: AdvisorScript[] = [
  {
    touch_no: 6,
    key: 'relationship_check_in',
    title: 'Advisor Task 1 — Relationship Check-In',
    script:
      "Hi {{first_name}}, this is {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. I handle the life insurance and financial services side for the agency's clients, so I am probably a new name to you. I am not calling to sell you anything today. I mostly wanted to introduce myself and let you know that if a question about life insurance ever comes up, you have someone here to ask. Is there anything you have wondered about that I could answer while I have you?",
    goals: [
      'introduce the FSA as part of the existing agency relationship',
      'remove any expectation that the call leads to a sale',
      'answer one real question if the client has one',
      'establish permission for future contact',
    ],
  },
  {
    touch_no: 16,
    key: 'needs_discovery',
    title: 'Advisor Task 2 — Needs Discovery',
    script:
      "Hi {{first_name}}, it is {{fsa_name}}. I wanted to follow up on the note I sent about a protection review. Rather than talk at you about insurance, I would find it more useful to ask: who would feel it financially if your income stopped, and what would still need paying? If those questions have easy answers, you are probably in good shape and I will say so. If they do not, that is usually where a short conversation helps.",
    goals: [
      'open with the client situation rather than a product',
      'surface who depends on the income and what obligations remain',
      'be willing to conclude no action is needed',
      'book a needs-analysis appointment only where one is warranted',
    ],
  },
  {
    touch_no: 26,
    key: 'personal_review_invitation',
    title: 'Advisor Task 3 — Personal Review Invitation',
    script:
      "Hi {{first_name}}, {{fsa_name}} here. I wanted to invite you personally to a complimentary protection review. It runs about twenty minutes, there is no cost, and there is no obligation to do anything afterwards. We would talk through who depends on you, what would still need paying, and what you already have in place. A fair number of these end with me telling someone they are already well covered. Would that be worth twenty minutes of your time?",
    goals: [
      'make a specific, concrete invitation with a defined time cost',
      'state plainly that no action is required',
      'book the appointment where the client is willing',
      'move engaged clients into the formal life insurance workflow',
    ],
  },
  {
    touch_no: 32,
    key: 'final_personal_outreach',
    title: 'Advisor Task 4 — Final Personal Outreach',
    script:
      "Hi {{first_name}}, this is {{fsa_name}}. I wanted to reach out once personally before I close this follow-up. If life insurance is not something you need to think about right now, that is a completely reasonable place to be and I will stop here. If it is on your mind at some point, this year or in five, call me directly and we will pick it up. Either way, thank you for being a client of the agency.",
    goals: [
      'close the sequence warmly and without pressure',
      'give the client a dignified way to decline',
      'leave a durable, standing offer for future contact',
      'protect the agency relationship above the conversion',
    ],
  },
]

export function advisorScriptForTouch(touchNo: number): AdvisorScript | null {
  return ADVISOR_SCRIPTS.find((s) => s.touch_no === touchNo) ?? null
}
