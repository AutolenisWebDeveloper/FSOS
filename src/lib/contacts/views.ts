/*
 * Contacts saved views (redesign spec §4.1 / §17.5). Turns the per-workflow
 * client lists (Conversion / Cross-Sell / Win-Back / …) into saved filters over
 * ONE population — the book — instead of bespoke tables. This module is the
 * single source of truth for the view set and the membership rules.
 *
 * Pure and self-contained (no cross-module imports) so membership is unit-tested
 * directly and shared by the Contacts page (server aggregation) and the list rail.
 */

export const CONTACT_VIEWS = [
  { key: 'all', label: 'All' },
  { key: 'my-book', label: 'My Book' },
  { key: 'prospects', label: 'Prospects' },
  { key: 'active', label: 'Active Clients' },
  { key: 'conversion', label: 'Conversion-Eligible' },
  { key: 'cross-sell', label: 'Cross-Sell' },
  { key: 'win-back', label: 'Win-Back' },
  { key: 'needs-contact', label: 'Needs Contact' },
  { key: 'review-due', label: 'Review Due' },
] as const

export type ContactViewKey = (typeof CONTACT_VIEWS)[number]['key']

export const CONTACT_VIEW_KEYS = CONTACT_VIEWS.map((v) => v.key) as readonly ContactViewKey[]

export function isContactView(value: string): value is ContactViewKey {
  return (CONTACT_VIEW_KEYS as readonly string[]).includes(value)
}

const REVIEW_DUE_DAYS = 365
const NEEDS_CONTACT_DAYS = 30

export interface ContactViewInput {
  archived: boolean
  doNotContact: boolean
  policyCount: number
  /** Holds a policy in an in-force status (active/bound/renewed). */
  activePolicy: boolean
  /** Holds a competitor (not-with-us) policy → cross-sell signal. */
  heldAwayPolicy: boolean
  /** Holds a lapsed/cancelled/non-renewed policy → win-back signal. */
  lapsedPolicy: boolean
  /** Holds a non-securities policy with a future term-conversion deadline. */
  conversionEligible: boolean
  hasReview: boolean
  /** Age in days of the most recent review (null = none on file). */
  lastReviewAgeDays: number | null
  /** True if any activity landed within the needs-contact window. */
  recentlyContacted: boolean
}

/** Which saved views a household belongs to. `all` always included. */
export function contactViewKeys(i: ContactViewInput): ContactViewKey[] {
  const keys: ContactViewKey[] = ['all']
  if (!i.archived) keys.push('my-book')
  if (i.policyCount === 0 && !i.archived) keys.push('prospects')
  if (i.activePolicy) keys.push('active')
  if (i.conversionEligible) keys.push('conversion')
  if (i.heldAwayPolicy) keys.push('cross-sell')
  if (i.lapsedPolicy) keys.push('win-back')
  if (!i.doNotContact && !i.archived && !i.recentlyContacted) keys.push('needs-contact')
  if (!i.hasReview || (i.lastReviewAgeDays !== null && i.lastReviewAgeDays > REVIEW_DUE_DAYS)) keys.push('review-due')
  return keys
}

export const CONTACT_VIEW_WINDOWS = { reviewDueDays: REVIEW_DUE_DAYS, needsContactDays: NEEDS_CONTACT_DAYS }
