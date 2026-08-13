// src/lib/district-nurture/playbooks.ts
// PURE curriculum + live-touchpoint + calendar-overlay data for the District Agent FS
// Nurture Campaign ("The Second Conversation", ADR-038). No imports — versioned data only.
//
// This is the agent-education matrix: for each of the 12 sequential modules it records
// what the concept is, the client statement that SIGNALS it, what the agent MAY say, what
// REQUIRES the licensed FSA, and how to introduce. It is the reference the UI renders and
// the source the content migration (113) was written against. It authorizes no send and
// makes no recommendation.

export interface CurriculumModule {
  module_no: number
  title: string
  objective: string
  /** What the concept/product generally does + the need it addresses. */
  concept: string
  /** Client statements that indicate an opportunity. */
  client_signals: string[]
  /** Green-zone: what the (unlicensed-for-FS) agent may say. */
  agent_may_say: string
  /** Red-line: what requires the licensed FSA. */
  requires_fsa: string
  /** How to make the introduction. */
  how_to_introduce: string
  /** Product/education categories touched (labels only, never a recommendation). */
  topics: string[]
}

export const CURRICULUM: CurriculumModule[] = [
  {
    module_no: 1,
    title: 'Financial foundations',
    objective: 'Establish the partnership and teach the agent to notice money signals.',
    concept:
      'Financial planning starts with noticing. Clients reveal money concerns in passing; the agent is uniquely positioned to hear them.',
    client_signals: ['We are stretched thin this month.', 'I finally paid off the truck.', 'The baby is due in spring.'],
    agent_may_say:
      '"That is exactly the kind of thing my Financial Services partner helps people think through. Want me to connect you? No cost, no pressure."',
    requires_fsa: 'Anything specific, numeric, product-related, suitability, tax treatment, or comparison.',
    how_to_introduce: 'Reply to the FSA or send the scheduling link; the FSA takes it from there and keeps the agent looped in.',
    topics: ['Financial foundations', 'Referral mindset'],
  },
  {
    module_no: 2,
    title: 'Managing money, reserves and debt',
    objective: 'Spot household fragility from cash reserves and high-interest debt.',
    concept:
      'A cash reserve is money reachable fast (often a few months of expenses); high-interest debt quietly undoes other progress.',
    client_signals: ['We had to put the deductible on a card.', 'We are just trying to catch up.', 'Every month is tight.'],
    agent_may_say: '"You are not the only one juggling this. My Financial Services partner does a simple, no-cost review. Want an introduction?"',
    requires_fsa: 'The actual reserve target, any debt approach, and anything about accounts.',
    how_to_introduce: 'Forward the scheduling link or reply with the client name.',
    topics: ['Emergency reserves', 'Debt management', 'Cash flow'],
  },
  {
    module_no: 3,
    title: 'Retirement planning for agency owners',
    objective: 'Start with the owner’s own plan, then hear "someday" in the book.',
    concept:
      'Self-employed owners have no automatic employer plan; general structures exist but the right one depends entirely on the situation.',
    client_signals: ['I do not know if I can retire.', 'I have an old 401k from a job I left.', 'I keep meaning to figure this out.'],
    agent_may_say: '"Figuring that out is exactly what my Financial Services partner does. It is a no-cost conversation. Want me to connect you?"',
    requires_fsa: 'Accounts, rollovers, income, or any product; anything with the word "invest" in it (licensed/registered).',
    how_to_introduce: 'Reply with the name or send the scheduling link.',
    topics: ['Retirement', 'Owner planning'],
  },
  {
    module_no: 4,
    title: 'Homeownership and household protection',
    objective: 'Connect the mortgage to the income that pays it.',
    concept: 'A mortgage is a long obligation that survives the earner; life insurance is one common way households keep a home a home.',
    client_signals: ['We just bought.', 'We refinanced.', 'It would be a stretch on one income.'],
    agent_may_say: '"Now that the mortgage is set, a lot of folks make sure their family could keep the home no matter what. My FS partner walks through that at no cost."',
    requires_fsa: 'Coverage amounts, product type, health and pricing questions.',
    how_to_introduce: 'Send the scheduling link at closing/refi, or reply with the name.',
    topics: ['Mortgage protection', 'Life insurance need'],
  },
  {
    module_no: 5,
    title: 'Family protection and education funding',
    objective: 'Use family milestones as the natural protection conversation.',
    concept: 'Family protection is income continuity if a parent is gone; education funding is a separate general category with several approaches.',
    client_signals: ['We are expecting.', 'The kids start college in a few years.', 'I want them to have it easier than I did.'],
    agent_may_say: '"Congratulations. My Financial Services partner does a free review that makes sure everyone is covered. Want me to set it up?"',
    requires_fsa: 'How much protection, what kind, and any education-funding plan.',
    how_to_introduce: 'Reply with the family name or forward the scheduling link.',
    topics: ['Family protection', 'Education funding'],
  },
  {
    module_no: 6,
    title: 'Financial Needs Analysis',
    objective: 'Aim every conversation at the FNA appointment.',
    concept: 'An FNA looks at income to replace, remaining debt, final expenses, education plans, and support duration — arithmetic and honesty, not a pitch.',
    client_signals: ['I have no idea if we have enough.', 'How do people even decide this?'],
    agent_may_say: '"There is a free, no-obligation review my Financial Services partner does. Twenty minutes, and you actually know where you stand. Want me to book it?"',
    requires_fsa: 'The entire analysis, every number, and any recommendation that follows.',
    how_to_introduce: 'Send the scheduling link or reply to have the FSA book it.',
    topics: ['Financial Needs Analysis'],
  },
  {
    module_no: 7,
    title: 'Business-owner planning',
    objective: 'Flag key-person and continuity exposures for business-owner clients.',
    concept: 'Key-person risk and buy-sell/continuity are general concepts with several structures; funding and mechanics are a licensed, multi-professional conversation.',
    client_signals: ['It would all fall apart without me.', 'My partner and I never put anything in writing.'],
    agent_may_say: '"You have built something real. Have you protected what happens to it if something happens to you? My FS partner does a no-cost continuity conversation."',
    requires_fsa: 'The plan, funding, ownership mechanics, and any recommendation (coordinated with attorney/accountant).',
    how_to_introduce: 'Reply with the business name or send the scheduling link.',
    topics: ['Buy-sell', 'Key person', 'Business continuity'],
  },
  {
    module_no: 8,
    title: 'Term, Whole Life, IUL and VUL education',
    objective: 'Recognize the product conversation without picking a product.',
    concept:
      'Term covers a set period; whole life is permanent with cash value; IUL and VUL are more complex permanent products — VUL involves securities and is strictly a licensed, registered conversation.',
    client_signals: ['Which kind should I get?', 'Is whole life a rip-off or not?', 'Someone pitched me an IUL.'],
    agent_may_say: '"Honestly, that depends on your situation and it is worth getting right. My Financial Services partner will walk you through it, no cost, no pressure."',
    requires_fsa: 'Picking, comparing, or sizing any product; every IUL/VUL conversation (VUL is registered/securities).',
    how_to_introduce: 'Route the product question to the FSA every time.',
    topics: ['Term', 'Whole life', 'IUL', 'VUL'],
  },
  {
    module_no: 9,
    title: 'Protection planning and LIAM',
    objective: 'Use Life Insurance Awareness Month as natural permission to ask.',
    concept: 'Protection planning is making sure a household can absorb a loss; most families are underinsured relative to need, though the right number is always personal.',
    client_signals: ['We have been meaning to look at this.', 'Any life change combined with "I am not sure we are covered."'],
    agent_may_say: '"September is Life Insurance Awareness Month. If something happened to you tomorrow, would your family be okay financially? If you are not sure, my FS partner reviews that for free."',
    requires_fsa: 'The amount, the product, and the recommendation.',
    how_to_introduce: 'Reply with the name or send the scheduling link. See CALENDAR_OVERLAYS for the September activation.',
    topics: ['Protection planning', 'LIAM'],
  },
  {
    module_no: 10,
    title: 'Investments, IRAs, rollovers and money in motion',
    objective: 'The firmest boundary: recognize money in motion and refer immediately.',
    concept:
      'Money in motion is any moment significant money changes hands or accounts (job change, rollover, inheritance, maturing account). Investments, IRAs, rollovers, and securities are licensed, registered activities.',
    client_signals: ['I am changing jobs and have a 401k to deal with.', 'My mom left me some money.', 'My CD is maturing and I do not know what to do.'],
    agent_may_say: '"That is important, and it is exactly what my Financial Services partner is licensed for. Let me connect you right now so nothing gets missed."',
    requires_fsa: 'Everything. Never advise on, compare, or recommend an investment or rollover — not even casually.',
    how_to_introduce: 'Reply immediately with the client name and situation, or send the scheduling link. Speed matters.',
    topics: ['Investments', 'IRAs', 'Rollovers', 'Money in motion'],
  },
  {
    module_no: 11,
    title: 'Annuities and retirement-income planning',
    objective: 'Hear "will I run out of money?" and open the income conversation.',
    concept: 'Retirement-income planning turns savings into a lasting paycheck; annuities are one general category with trade-offs, costs, and rules that must be understood.',
    client_signals: ['I am afraid of outliving my money.', 'I want something guaranteed.', 'I do not want to watch the market in retirement.'],
    agent_may_say: '"Making your savings last is a real skill, and my Financial Services partner does exactly this. It is a free conversation. Want me to introduce you?"',
    requires_fsa: 'Any product, any guarantee, any number, any comparison — especially anything registered.',
    how_to_introduce: 'Reply with the name or send the scheduling link.',
    topics: ['Annuities', 'Retirement income'],
  },
  {
    module_no: 12,
    title: 'Education, legacy, beneficiaries and annual planning',
    objective: 'Close the year on beneficiaries, legacy, and a standing referral rhythm.',
    concept: 'Beneficiary designations control who receives an account/policy and override a will; legacy planning is broader and usually involves several professionals.',
    client_signals: ['I got divorced years ago.', 'I am not sure who my beneficiary is.', 'I want to leave something for the grandkids.'],
    agent_may_say: '"It is worth checking those every few years." (A reminder only.)',
    requires_fsa: 'The review and any changes; legacy structuring.',
    how_to_introduce: 'Offer a beneficiary check and hand off; set up an annual referral rhythm.',
    topics: ['Beneficiaries', 'Legacy', 'Annual review'],
  },
]

export function moduleByNumber(n: number | null | undefined): CurriculumModule | null {
  return CURRICULUM.find((m) => m.module_no === n) ?? null
}

// ── Quarterly LIVE touchpoints (advisor_outreach — human, never auto-dispatched) ──
export interface LiveTouchpoint {
  key: string
  touch_no: number
  quarter: 1 | 2 | 3 | 4
  title: string
  /** Human talking-track for the live call/workshop. Nothing is auto-sent. */
  script: string
  goals: string[]
}

export const LIVE_TOUCHPOINTS: LiveTouchpoint[] = [
  {
    key: 'q1_partnership_call',
    touch_no: 10,
    quarter: 1,
    title: 'Q1 Live Touchpoint — Quarterly partnership call',
    script:
      'Thank the agent for the first quarter. Recap the "notice, name it, introduce" habit from Modules 1-3. Ask which client signals they have heard. Offer to co-review one household together. Confirm the scheduling link is easy to hand out.',
    goals: ['Reinforce the referral habit', 'Surface one live introduction', 'Confirm the hand-off mechanics work'],
  },
  {
    key: 'q2_fna_workshop',
    touch_no: 20,
    quarter: 2,
    title: 'Q2 Live Touchpoint — Mid-year FNA workshop',
    script:
      'Walk the agent through a sample Financial Needs Analysis end to end so they can describe the value in one sentence. Emphasize the FNA is the highest-value introduction. Book a joint FNA with a real client if one is ready.',
    goals: ['Make the FNA tangible', 'Equip a one-sentence pitch', 'Book a joint FNA'],
  },
  {
    key: 'q3_liam_review',
    touch_no: 30,
    quarter: 3,
    title: 'Q3 Live Touchpoint — LIAM referral push review',
    script:
      'Review the September Life Insurance Awareness Month push. Count the "not sure" answers turned into introductions. Celebrate wins, troubleshoot friction, and reset for Q4. Reiterate the money-in-motion boundary from Module 10.',
    goals: ['Review LIAM results', 'Remove referral friction', 'Reinforce the securities boundary'],
  },
  {
    key: 'q4_annual_review',
    touch_no: 40,
    quarter: 4,
    title: 'Q4 Live Touchpoint — Annual review and next-year plan',
    script:
      'Close the year: total introductions, FNAs, and outcomes. Thank the agent specifically. Establish a standing annual referral rhythm and an annual-review cadence for their book. Set expectations for continuing the partnership.',
    goals: ['Report the year', 'Establish a standing rhythm', 'Renew the partnership'],
  },
]

export function liveTouchpointForTouch(touchNo: number): LiveTouchpoint | null {
  return LIVE_TOUCHPOINTS.find((l) => l.touch_no === touchNo) ?? null
}

// ── Calendar overlays (ADR-038 §5) ────────────────────────────────────────────
// The curriculum is SEQUENTIAL relative to the enrollment baseline. Genuinely seasonal
// initiatives are overlays realized as scheduled activation tasks, NEVER a reordering of
// the touch sequence. `month` is the calendar month (1-12) the overlay activates in.
export interface CalendarOverlay {
  key: string
  month: number
  title: string
  note: string
  /** The operational action FSOS surfaces as a scheduled activation task. */
  activation: string
}

export const CALENDAR_OVERLAYS: CalendarOverlay[] = [
  {
    key: 'liam_september',
    month: 9,
    title: 'Life Insurance Awareness Month',
    note: 'September gives agents built-in permission to raise protection planning (Module 9 theme).',
    activation: 'Surface a LIAM referral-push task to every active enrollment in September, regardless of curriculum position.',
  },
  {
    key: 'tax_season_money_in_motion',
    month: 1,
    title: 'Tax season / money in motion',
    note: 'Jan-Apr surfaces rollovers, contributions, and refunds (Module 10 theme).',
    activation: 'Remind agents to route tax-season money-in-motion moments to the FSA; schedule a Q1 refresher task.',
  },
  {
    key: 'year_end_beneficiary',
    month: 12,
    title: 'Year-end beneficiary and annual review',
    note: 'December is a natural moment for beneficiary checks and annual reviews (Module 12 theme).',
    activation: 'Schedule a year-end beneficiary-check reminder task for active enrollments.',
  },
]

/** Overlays active in a given calendar month (1-12). Pure lookup for the scheduler/UI. */
export function overlaysForMonth(month: number): CalendarOverlay[] {
  return CALENDAR_OVERLAYS.filter((o) => o.month === month)
}
