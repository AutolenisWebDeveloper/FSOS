// src/lib/comms/keywords.ts
// Pure inbound-keyword classification (opt-out / opt-in / help). Kept dependency-free
// so the compliance-critical STOP/START handling is unit-testable offline. Carrier-
// standard keywords (case-insensitive, first word of the message).

export type Intent = 'stop' | 'start' | 'help' | 'message'

export const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke'] as const
export const START_WORDS = ['start', 'unstop', 'yes', 'optin', 'subscribe'] as const
export const HELP_WORDS = ['help', 'info'] as const

export function classifyKeyword(body: string): Intent {
  const first = (body || '').trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, '') || ''
  if ((STOP_WORDS as readonly string[]).includes(first)) return 'stop'
  if ((START_WORDS as readonly string[]).includes(first)) return 'start'
  if ((HELP_WORDS as readonly string[]).includes(first)) return 'help'
  return 'message'
}
