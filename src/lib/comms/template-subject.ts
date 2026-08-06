// src/lib/comms/template-subject.ts
// Single source of truth for reading a campaign email's SUBJECT out of its template body.
//
// `comm_templates` has NO `subject` column (migration 009 DDL; 087_comms_console.sql says so
// outright). The repo convention is that an email body carries its subject on a leading
// "Subject:" line, which the marketing shell (notifications/email-shell.ts parseHeaders) also
// strips and renders as the card H1. This helper extracts the same line for the send envelope
// so the stored/dispatched subject matches what the recipient sees as the headline.
//
// Extracted here (CLAUDE.md §6 — consolidate, don't fragment) because all three campaign ticks
// need it: cross-sell-life had a private copy, while pipeline-winback and life-campaign instead
// selected a non-existent `subject` COLUMN — a PostgREST 42703 that returns null, blanking the
// body and mis-routing every email touch into the SMS branch. Pure + dependency-free.

/**
 * The subject on a body's leading "Subject:" line, or undefined when absent.
 * Only the FIRST line is considered, matching email-shell.ts's header parsing.
 */
export function parseSubjectFromBody(body: string | null | undefined): string | undefined {
  const first = String(body ?? '').split('\n', 1)[0]?.trim() ?? ''
  const m = first.match(/^Subject:\s*(.+)$/i)
  return m ? m[1].trim() : undefined
}
