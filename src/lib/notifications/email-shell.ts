// src/lib/notifications/email-shell.ts
// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME email shell for TRANSACTIONAL / OPERATIONAL emails (form links, booking
// acks, FSA ops alerts, the morning briefing). These sends happen at request time,
// so they CANNOT use react-email (ADR-025 keeps it a devDependency, out of the
// runtime bundle). This module renders the SAME premium design as the campaign
// templates (src/emails/_layout.tsx) but as pure HTML strings, resolving every
// value through the shared brand tokens (src/lib/email/brand.ts) — one design
// system expressed in the two contexts email rendering requires (CLAUDE.md §6).
//
// It is pure (no I/O). All caller-supplied TEXT is HTML-escaped here, so a caller
// can pass raw values safely (stored/reflected-XSS defense, §13.8). URLs used in
// hrefs are attribute-escaped.
//
// Transactional emails are exempt from the CAN-SPAM unsubscribe requirement (they
// are a direct response to a user action, not marketing), so — unlike the campaign
// shell — this footer carries sender identification (NAP) WITHOUT an opt-out link.
import { EMAIL_COLORS as C, EMAIL_FONT, EMAIL_TYPE as T, EMAIL_LAYOUT as L, EMAIL_BRAND, EMAIL_IDENTITY as ID } from '@/lib/email/brand'

/** HTML-escape text content (and attribute values). */
export function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A label/value detail row for {@link detailTableHtml}. */
export interface ShellRow {
  label: string
  value: string | null | undefined
}

/** A body paragraph. */
export function paragraphHtml(text: string): string {
  return `<p style="margin:0 0 16px;color:${C.body};font-size:${T.body}px;line-height:1.7;">${esc(text)}</p>`
}

/** A soft brand-wash callout with a Farmers-blue left accent. */
export function calloutHtml(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr><td style="background:${C.wash};border-left:4px solid ${C.brand};border-radius:8px;padding:14px 18px;color:${C.ink};font-size:${T.body}px;line-height:1.6;">${esc(text)}</td></tr>
  </table>`
}

/** A bulletproof primary CTA button (VML shim for Outlook). */
export function buttonHtml(label: string, href: string): string {
  const h = esc(href)
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">
    <tr><td align="center" bgcolor="${C.brand}" style="border-radius:8px;">
      <!--[if mso]>&nbsp;<![endif]-->
      <a href="${h}" style="display:inline-block;background:${C.brand};color:${C.white};font-size:${T.body}px;font-weight:700;line-height:20px;text-decoration:none;padding:14px 30px;border-radius:8px;">${esc(label)}</a>
      <!--[if mso]>&nbsp;<![endif]-->
    </td></tr>
  </table>`
}

/** A bordered label/value detail table. Empty-valued rows are dropped. */
export function detailTableHtml(rows: ShellRow[]): string {
  const kept = rows.filter((r) => r.value != null && String(r.value).trim() !== '')
  if (!kept.length) return ''
  const body = kept
    .map(
      (r, i) => `<tr>
        <td style="padding:10px 0;${i === 0 ? '' : `border-top:1px solid ${C.border};`}width:132px;vertical-align:top;color:${C.muted};font-size:${T.fine}px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">${esc(r.label)}</td>
        <td style="padding:10px 0;${i === 0 ? '' : `border-top:1px solid ${C.border};`}vertical-align:top;color:${C.ink};font-size:${T.body}px;line-height:1.5;">${esc(r.value)}</td>
      </tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${C.border};border-radius:10px;padding:2px 16px;">${body}</table>`
}

/** Small muted fine-print line. */
export function fineHtml(text: string): string {
  return `<p style="margin:0 0 8px;color:${C.muted};font-size:${T.small}px;line-height:1.6;">${esc(text)}</p>`
}

/** Raw pre-escaped body (used for AI-generated plaintext blocks that are escaped upstream). */
export function rawBlockHtml(preEscapedHtml: string): string {
  return preEscapedHtml
}

export interface ShellOptions {
  /** Inbox preheader line (hidden preview text). */
  preheader?: string
  /** The eyebrow label above the heading (uppercased). */
  eyebrow?: string
  /** The H1 heading (plain text; escaped). */
  heading: string
  /** Pre-composed body HTML (use the *Html helpers above). */
  contentHtml: string
}

/**
 * Wrap composed body HTML in the shared premium chrome: brand-accent card, logo
 * letterhead, and a sender-identification footer. Returns a complete HTML document.
 */
export function renderEmailShell(opts: ShellOptions): string {
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>`
    : ''
  const eyebrow = opts.eyebrow
    ? `<p style="margin:0 0 10px;color:${C.primary};font-size:${T.eyebrow}px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;">${esc(opts.eyebrow)}</p>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
</head>
<body style="margin:0;padding:0;background:${C.canvas};font-family:${EMAIL_FONT};">
  ${pre}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="${L.maxWidth}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${L.maxWidth}px;background:${C.surface};border-radius:${L.radius}px;border-top:4px solid ${C.brand};overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:26px 36px 16px;">
          <img src="${EMAIL_BRAND.logoUrl}" alt="${esc(EMAIL_BRAND.logoAlt)}" width="${EMAIL_BRAND.logoWidth}" height="${EMAIL_BRAND.logoHeight}" style="display:block;border:0;outline:none;text-decoration:none;">
          <div style="margin-top:14px;color:${C.muted};font-size:${T.eyebrow}px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${esc(ID.agent)} &nbsp;·&nbsp; ${esc(ID.title)}</div>
        </td></tr>
        <tr><td style="padding:0 36px;"><div style="border-top:1px solid ${C.border};"></div></td></tr>
        <!-- Body -->
        <tr><td style="padding:24px 36px 8px;">
          ${eyebrow}
          <h1 style="margin:0 0 16px;color:${C.ink};font-size:${T.h1}px;line-height:1.25;font-weight:700;">${esc(opts.heading)}</h1>
          ${opts.contentHtml}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:${C.canvas};border-top:1px solid ${C.border};padding:22px 36px 30px;">
          <p style="margin:0 0 8px;color:${C.body};font-size:${T.small}px;line-height:1.6;font-weight:700;">${esc(ID.agent)} · ${esc(ID.title)}</p>
          <p style="margin:0 0 8px;color:${C.muted};font-size:${T.small}px;line-height:1.6;">
            <a href="tel:${esc(ID.phone)}" style="color:${C.primary};text-decoration:none;">${esc(ID.phone)}</a>
            &nbsp;·&nbsp;
            <a href="mailto:${esc(ID.email)}" style="color:${C.primary};text-decoration:none;">${esc(ID.email)}</a>
          </p>
          <p style="margin:0;color:${C.faint};font-size:${T.micro}px;line-height:1.7;">
            ${esc(ID.brand)} · ${esc(ID.mailingAddress)}<br>
            ${esc(ID.licensing)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
