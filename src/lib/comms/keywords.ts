// src/lib/comms/keywords.ts
// Pure inbound-keyword classification (opt-out / opt-in / help). Kept dependency-free
// so the compliance-critical STOP/START handling is unit-testable offline. Carrier-
// standard keywords (case-insensitive). STOP/HELP match the first word; START only a bare keyword.

export type Intent = 'stop' | 'start' | 'help' | 'message'

export const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke'] as const
export const START_WORDS = ['start', 'unstop', 'yes', 'optin', 'subscribe'] as const
export const HELP_WORDS = ['help', 'info'] as const

export function classifyKeyword(body: string): Intent {
  const words = (body || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const first = words[0]?.replace(/[^a-z]/g, '') || ''
  // STOP keeps the broad first-word match: an opt-out must never be missed.
  if ((STOP_WORDS as readonly string[]).includes(first)) return 'stop'
  // An opt-IN counts only as a BARE keyword ("START", "Yes!"). "Yes, Tuesday works" is a reply
  // to a person, not a request to be re-subscribed (owner decision 4, audit B-02).
  if (words.length === 1 && (START_WORDS as readonly string[]).includes(first)) return 'start'
  if ((HELP_WORDS as readonly string[]).includes(first)) return 'help'
  return 'message'
}
