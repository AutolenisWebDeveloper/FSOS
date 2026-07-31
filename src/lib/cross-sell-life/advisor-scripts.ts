// src/lib/cross-sell-life/advisor-scripts.ts
// The four Cross-Sell Life advisor-outreach scripts (spec §10) as PURE, versioned data. Advisor
// touches are HUMAN tasks, never automatic impersonated calls (§10) — the tick creates a
// work_task + xsell_life_advisor_touches row carrying this script as the suggested opener; a real
// logged outreach ATTEMPT is what fulfils the touch (advisor.ts / §9a policy). Content is verbatim
// §10 intent; tokens are repo-native snake_case so they resolve in the task view.

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
      "Hi {{first_name}}, this is {{fsa_name}} with {{agency_name}}. I wanted to personally thank you for being a client and check in to see how you are doing. We are offering existing clients a complimentary life insurance protection review. There is no obligation—I simply wanted to make myself available if you have questions or would like to schedule a conversation.",
    goals: ['strengthen the relationship', 'confirm whether life insurance is relevant', 'offer a review', 'schedule an appointment when appropriate'],
  },
  {
    touch_no: 16,
    key: 'needs_discovery',
    title: 'Advisor Task 2 — Needs Discovery',
    script:
      'Hi {{first_name}}, I wanted to follow up personally regarding the protection review we offered. A lot can change over time, including family responsibilities, income, housing, and financial goals. I would be happy to help you review your current situation and answer any questions.',
    goals: ['discover life events', 'understand general protection concerns', 'schedule a needs-analysis appointment', 'do not provide recommendations without the required review'],
  },
  {
    touch_no: 26,
    key: 'personal_review_invitation',
    title: 'Advisor Task 3 — Personal Review Invitation',
    script:
      'Hi {{first_name}}, I wanted to personally invite you to schedule a complimentary protection review. We can discuss your current responsibilities, existing coverage, and any questions you may have. There is no obligation to purchase anything.',
    goals: ['book the appointment', 'resolve unanswered questions', 'transfer engaged clients into the formal life insurance workflow'],
  },
  {
    touch_no: 32,
    key: 'final_personal_outreach',
    title: 'Advisor Task 4 — Final Personal Outreach',
    script:
      'Hi {{first_name}}, I wanted to reach out personally one final time before we close this Cross-Sell Life follow-up. If life insurance is not a priority right now, I completely understand. If you would like to review it now or later, I would be glad to help whenever the time is right. Thank you for being a client.',
    goals: ['close respectfully', 'offer future follow-up', 'avoid pressure', 'preserve the relationship'],
  },
]

export function advisorScriptForTouch(touchNo: number): AdvisorScript | null {
  return ADVISOR_SCRIPTS.find((s) => s.touch_no === touchNo) ?? null
}
