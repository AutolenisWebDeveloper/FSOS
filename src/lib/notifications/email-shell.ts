// src/lib/notifications/email-shell.ts
// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME email shell — the premium FSOS email design as pure HTML strings.
//
// Two kinds of email render at request time and so CANNOT use react-email (ADR-025
// keeps it a devDependency, out of the runtime bundle):
//   1. TRANSACTIONAL / OPERATIONAL — form links, booking acks, FSA ops alerts, the
//      morning briefing (renderEmailShell + the *Html helpers).
//   2. CAMPAIGN / MARKETING bodies stored in comm_templates as plain text (library
//      blueprints + seed migrations) or authored by the FSA. wrapMarketingEmailBody()
//      wraps ANY such body in the same branded chrome AT SEND TIME (src/lib/comms/send.ts),
//      so every outbound campaign email is premium and consistent regardless of source —
//      one design system, applied at the single send choke-point (CLAUDE.md §6). A body
//      that is already a full HTML document (the react-email templates in src/emails/*,
//      rendered via templates:build) is passed through untouched — never double-wrapped.
//
// Both consume the shared brand tokens (src/lib/email/brand.ts) so the runtime emails
// match the react-email campaign templates and DESIGN.md §31. Pure (no I/O).
//
// Escaping contract:
//   • The *Html content helpers and renderEmailShell HTML-escape caller TEXT (so a
//     transactional caller can pass raw values safely — §13.8).
//   • wrapMarketingEmailBody receives a body that the send path already personalized
//     with recipient values HTML-ESCAPED (personalize {escapeHtml:true}); the remaining
//     static text is approval-gated author content. It therefore does NOT re-escape (that
//     would double-escape the values) — it only structures the text into branded HTML.
import { EMAIL_COLORS as C, EMAIL_FONT, EMAIL_TYPE as T, EMAIL_LAYOUT as L, EMAIL_ORIGIN, EMAIL_BRAND, EMAIL_IDENTITY as ID } from '@/lib/email/brand'

/** HTML-escape text content (and attribute values). */
export function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Shared chrome ────────────────────────────────────────────────────────────

/** The branded card header (logo letterhead + FSA identity). */
function headerHtml(): string {
  return `<tr><td style="padding:26px 36px 16px;">
      <img src="${EMAIL_BRAND.logoUrl}" alt="${esc(EMAIL_BRAND.logoAlt)}" width="${EMAIL_BRAND.logoWidth}" height="${EMAIL_BRAND.logoHeight}" style="display:block;border:0;outline:none;text-decoration:none;">
      <div style="margin-top:14px;color:${C.muted};font-size:${T.eyebrow}px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${esc(ID.agent)} &nbsp;·&nbsp; ${esc(ID.title)}</div>
    </td></tr>
    <tr><td style="padding:0 36px;"><div style="border-top:1px solid ${C.border};"></div></td></tr>`
}

/** Wrap header + body + footer in the premium card on the canvas. Returns a full document. */
function chrome(opts: { preheader?: string; innerHtml: string; footerHtml: string }): string {
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>`
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
        ${headerHtml()}
        <tr><td style="padding:24px 36px 8px;">
          ${opts.innerHtml}
        </td></tr>
        ${opts.footerHtml}
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Footer for TRANSACTIONAL emails: sender identification (NAP), no unsubscribe (exempt). */
function transactionalFooterHtml(): string {
  return `<tr><td style="background:${C.canvas};border-top:1px solid ${C.border};padding:22px 36px 30px;">
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
    </td></tr>`
}

/**
 * Footer for MARKETING emails (DESIGN.md §31.1): educational disclaimer + physical mailing
 * address (CAN-SPAM sender identification) + a visible, per-recipient unsubscribe link.
 * `unsubscribeUrl` is the resolved absolute link injected by the send path.
 */
function marketingFooterHtml(unsubscribeUrl: string): string {
  return `<tr><td style="background:${C.canvas};border-top:1px solid ${C.border};padding:22px 36px 30px;">
      <p style="margin:0 0 8px;color:${C.body};font-size:${T.small}px;line-height:1.6;">
        <a href="tel:${esc(ID.phone)}" style="color:${C.primary};text-decoration:none;">${esc(ID.phone)}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${esc(ID.email)}" style="color:${C.primary};text-decoration:none;">${esc(ID.email)}</a>
      </p>
      <p style="margin:0 0 12px;color:${C.muted};font-size:${T.fine}px;line-height:1.6;">
        This message is for educational and informational purposes only. It is not a product recommendation or a
        suitability determination. ${esc(ID.licensing)}.
      </p>
      <p style="margin:0;color:${C.faint};font-size:${T.micro}px;line-height:1.7;">
        ${esc(ID.brand)} · ${esc(ID.mailingAddress)}<br>
        <a href="${esc(unsubscribeUrl)}" style="color:${C.primary};text-decoration:underline;">Unsubscribe from marketing emails</a>
      </p>
    </td></tr>`
}

// ── Transactional content helpers ────────────────────────────────────────────

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

/** A label/value detail row for {@link detailTableHtml}. */
export interface ShellRow {
  label: string
  value: string | null | undefined
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
 * Wrap composed body HTML in the shared premium chrome with the TRANSACTIONAL footer.
 * For transactional/operational emails (form links, acks, alerts, briefing).
 */
export function renderEmailShell(opts: ShellOptions): string {
  const eyebrow = opts.eyebrow
    ? `<p style="margin:0 0 10px;color:${C.primary};font-size:${T.eyebrow}px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;">${esc(opts.eyebrow)}</p>`
    : ''
  const innerHtml = `${eyebrow}
          <h1 style="margin:0 0 16px;color:${C.ink};font-size:${T.h1}px;line-height:1.25;font-weight:700;">${esc(opts.heading)}</h1>
          ${opts.contentHtml}`
  return chrome({ preheader: opts.preheader, innerHtml, footerHtml: transactionalFooterHtml() })
}

// ── Marketing / campaign send-time wrap ──────────────────────────────────────

/** True if the body is already a full HTML document (react-email _layout output) — never re-wrap. */
export function isFullHtmlDocument(body: string): boolean {
  const s = String(body ?? '').trimStart().toLowerCase()
  return s.startsWith('<!doctype') || /<html[\s>]/.test(s)
}

// Bare absolute URL not already inside an href/attribute. Group 1 = the char before the URL.
const BARE_URL_RE = /(^|[^"'=>])(https?:\/\/[^\s<>()"']+)/g

/** Linkify bare absolute URLs in trusted author text (recipient values already escaped upstream). */
function linkify(text: string): string {
  return text.replace(
    BARE_URL_RE,
    (_m, pre: string, url: string) =>
      `${pre}<a href="${url}" style="color:${C.primary};text-decoration:underline;word-break:break-all;">${url}</a>`,
  )
}

/**
 * Convert a personalized plain-text body into branded HTML paragraphs. A leading
 * "Subject: …" line (present in some seed-migration bodies) is stripped — the real subject
 * is a separate field. Author text is trusted (approval-gated) and recipient values were
 * HTML-escaped upstream, so this does NOT re-escape; it structures + linkifies.
 */
export function plainTextToHtml(body: string): string {
  const cleaned = String(body ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/^\s*subject:.*(?:\n+|$)/i, '')
    .trim()
  const blocks = cleaned
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
  if (!blocks.length) return ''
  return blocks
    .map(
      (b) =>
        `<p style="margin:0 0 16px;color:${C.body};font-size:${T.body}px;line-height:1.7;">${linkify(b).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n')
}

export interface MarketingWrapOptions {
  /** Inbox preheader (typically the email subject). */
  preheader?: string | null
  /** Resolved absolute per-recipient unsubscribe URL (from the send path). */
  unsubscribeUrl?: string | null
}

/**
 * Wrap a personalized campaign/marketing email body in the premium branded shell with the
 * CAN-SPAM marketing footer. A body that is already a full HTML document (react-email
 * templates) is returned unchanged — never double-wrapped. Called at the send choke-point
 * so EVERY outbound campaign email (library blueprint, seed migration, FSA-authored, AI) is
 * premium and consistent.
 */
export function wrapMarketingEmailBody(body: string, opts: MarketingWrapOptions = {}): string {
  if (isFullHtmlDocument(body)) return body
  const unsub =
    opts.unsubscribeUrl && /^https?:\/\//i.test(opts.unsubscribeUrl)
      ? opts.unsubscribeUrl
      : `${EMAIL_ORIGIN}/unsubscribe`
  const bodyHtml = plainTextToHtml(body)
  const signoff = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;border-top:1px solid ${C.border};">
      <tr><td style="padding-top:18px;">
        <p style="margin:0 0 2px;color:${C.body};font-size:${T.body}px;line-height:1.5;">Warm regards,</p>
        <p style="margin:0;color:${C.brand};font-size:${T.body}px;font-weight:700;">${esc(ID.agent)}</p>
        <p style="margin:2px 0 0;color:${C.muted};font-size:${T.small}px;">${esc(ID.title)} · ${esc(ID.carrier)}</p>
      </td></tr>
    </table>`
  return chrome({
    preheader: opts.preheader ?? undefined,
    innerHtml: `${bodyHtml}\n${signoff}`,
    footerHtml: marketingFooterHtml(unsub),
  })
}
