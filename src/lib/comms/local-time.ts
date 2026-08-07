// src/lib/comms/local-time.ts
// PURE recipient-local time helpers for the quiet-hours gate step (no DB, no env),
// unit-testable offline (tests/quiet-hours-scope.test.mjs).
//
// Why IANA and not a fixed offset: the send path previously derived the recipient-local
// hour from a hardcoded UTC offset (Central -6), which is wrong during DST (CDT is -5,
// so the gate ran an hour early/late) and wrong for non-Central recipients. The hour is
// now resolved from an IANA timezone identifier via Intl (DST-correct by construction),
// defaulting to America/Chicago (the practice's home timezone). Callers that already
// resolved a per-recipient offset from a real IANA zone (the workshop engine) may still
// pass that offset explicitly.

/** Default recipient timezone when none is known — the practice's home zone (TX). */
export const DEFAULT_TIMEZONE = 'America/Chicago'

/**
 * Local hour-of-day (0–23) in an IANA timezone at `at` (default: now), DST-correct.
 * An unknown/invalid timezone falls back to DEFAULT_TIMEZONE; if Intl itself fails,
 * the legacy fixed CST offset (-6) is the last-resort floor.
 */
export function localHourInTimeZone(timeZone: string = DEFAULT_TIMEZONE, at: Date = new Date()): number {
  for (const tz of [timeZone, DEFAULT_TIMEZONE]) {
    try {
      const h = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(at),
      )
      if (Number.isInteger(h) && h >= 0 && h <= 23) return h
    } catch {
      // invalid timezone id → try the default, then the fixed-offset floor
    }
  }
  return (at.getUTCHours() - 6 + 24) % 24
}

/**
 * The "live conversation" window for the human-authored quiet-hours exemption: a
 * human-typed 1:1 SMS is only treated as part of a live conversation when the contact
 * sent an inbound message within the preceding 24 hours. Outside the window the send
 * falls through to the unclassified default and stays quiet-hours gated.
 */
export const LIVE_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000

/** True when `lastInboundAt` is within the live-conversation window before `now`. */
export function withinLiveConversationWindow(
  lastInboundAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false
  const t = new Date(lastInboundAt).getTime()
  if (!Number.isFinite(t)) return false
  return now.getTime() - t <= LIVE_CONVERSATION_WINDOW_MS
}
