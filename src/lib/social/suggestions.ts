// Heuristic posting-time suggestions (ADR-026, item 6). EXPLICITLY static best-
// practice windows — NOT a trend/time-prediction model. Per the build instruction,
// suggested posting times stay heuristic and clearly LABELED as such until analytics
// has real historical data to learn from. Do not replace this with a model here.
// Pure + relative imports so the offline gate tests compile with plain tsc.

import type { SocialPlatform } from './adapters/types'

// The label every surface must show alongside a suggested time, so the FSA always
// knows it is a rule of thumb, not a data-driven prediction (§4.3 honesty).
export const SUGGESTION_BASIS_LABEL =
  'Heuristic best-practice window — not based on your audience data yet.'

export interface PostingWindow {
  /** Short human window, e.g. "Tue–Thu, 2–4pm CT". */
  label: string
  days: string
  time: string
}

// Static, editable defaults (America/Chicago — the FSA's market). Config defaults,
// not measured facts.
export const HEURISTIC_POSTING_WINDOWS: Record<SocialPlatform, PostingWindow> = {
  youtube: { days: 'Tue–Thu', time: '2–4pm CT', label: 'Tue–Thu, 2–4pm CT' },
  facebook_page: { days: 'Mon–Fri', time: '9–11am CT', label: 'Weekday mornings, 9–11am CT' },
  instagram: { days: 'Wed–Fri', time: '11am–1pm CT', label: 'Wed–Fri, 11am–1pm CT' },
  linkedin_company: { days: 'Tue–Thu', time: '8–10am CT', label: 'Tue–Thu, 8–10am CT' },
  x: { days: 'Mon–Fri', time: '8–10am CT', label: 'Weekday mornings, 8–10am CT' },
  tiktok: { days: 'Tue–Thu', time: '6–9pm CT', label: 'Tue–Thu evenings, 6–9pm CT' },
}

export function suggestedPostingWindow(platform: SocialPlatform): PostingWindow {
  return HEURISTIC_POSTING_WINDOWS[platform]
}
