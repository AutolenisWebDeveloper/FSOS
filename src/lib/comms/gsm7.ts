// src/lib/comms/gsm7.ts
// The GSM-7 character set — the SINGLE definition for "will this SMS body force UCS-2?".
//
// A character outside GSM-7 downgrades the whole message to UCS-2, which cuts the per-segment
// budget from 160/153 to 70/67 and can silently double or triple the cost of every send. Two
// consumers need to agree on that question: the operator segment/encoding preview
// (console.smsSegmentInfo) and the guardrail tests that reject non-GSM-7 characters in authored
// SMS copy before it ships.
//
// Extracted here so those consumers share one definition rather than each carrying its own
// (CLAUDE.md §6 — never create a competing pattern). The guardrail test previously approximated
// GSM-7 as printable ASCII, which is STRICTER than the real set: it would have rejected valid
// GSM-7 characters (£, é, ù, Ø, €) as if they forced UCS-2, with a misleading failure message.
//
// Pure data + pure functions, no imports — so a test can compile this file standalone.

/** GSM-7 basic set: one septet each. */
export const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/** GSM-7 extension table: still GSM-7, but each costs an escape + the character (two septets). */
export const GSM7_EXT = '^{}\\[~]|€'

/** True if `ch` is representable in GSM-7 (basic or extension) — i.e. does not force UCS-2. */
export function isGsm7Char(ch: string): boolean {
  return GSM7_BASIC.includes(ch) || GSM7_EXT.includes(ch)
}

/**
 * The characters in `body` that are NOT representable in GSM-7 — i.e. the ones that would force
 * the whole message to UCS-2. Empty array ⇒ the body stays GSM-7. Iterates by code point, so a
 * non-BMP character (e.g. an emoji) is reported as one character rather than two surrogate halves.
 */
export function nonGsm7Chars(body: string): string[] {
  return [...(body ?? '')].filter((ch) => !isGsm7Char(ch))
}

/** True if the whole body stays GSM-7 (no UCS-2 downgrade). */
export function isGsm7Safe(body: string): boolean {
  return nonGsm7Chars(body).length === 0
}
