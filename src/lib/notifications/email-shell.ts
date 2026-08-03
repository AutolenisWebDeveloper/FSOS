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
import { EMAIL_COLORS as C, EMAIL_FONT, EMAIL_TYPE as T, EMAIL_LAYOUT as L, EMAIL_ORIGIN, EMAIL_BRAND, EMAIL_IDENTITY as ID, EMAIL_SIGNATURE as SIG } from '@/lib/email/brand'

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

/**
 * Progressive-enhancement responsive + dark-mode hints (DESIGN.md §31). Inline styles remain
 * the source of truth; this only tightens padding on small screens and softens the canvas in
 * dark mode for clients that honor a <style> block — it is never depended upon. Kept in
 * lockstep with src/emails/_layout.tsx so both email surfaces behave identically.
 */
const RESPONSIVE_CSS = `
    @media only screen and (max-width:600px){
      .fsos-card{width:100% !important;border-radius:0 !important}
      .fsos-pad{padding-left:22px !important;padding-right:22px !important}
    }
    @media (prefers-color-scheme:dark){ body,.fsos-canvas{background:#0B1526 !important} }`

/** The branded card header (logo letterhead + FSA identity). */
function headerHtml(): string {
  return `<tr><td class="fsos-pad" style="padding:26px 36px 16px;">
      <img src="${EMAIL_BRAND.logoUrl}" alt="${esc(EMAIL_BRAND.logoAlt)}" width="${EMAIL_BRAND.logoWidth}" height="${EMAIL_BRAND.logoHeight}" style="display:block;border:0;outline:none;text-decoration:none;">
      <div style="margin-top:14px;color:${C.muted};font-size:${T.eyebrow}px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${esc(ID.agent)} &nbsp;·&nbsp; ${esc(ID.title)}</div>
    </td></tr>
    <tr><td class="fsos-pad" style="padding:0 36px;"><div style="border-top:1px solid ${C.border};"></div></td></tr>`
}

/** Wrap header + body + footer in the premium card on the canvas. Returns a full document. */
function chrome(opts: { preheader?: string; innerHtml: string; footerHtml: string }): string {
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(opts.preheader)}</div>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>${RESPONSIVE_CSS}
  </style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};font-family:${EMAIL_FONT};">
  ${pre}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fsos-canvas" style="background:${C.canvas};">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="${L.maxWidth}" cellpadding="0" cellspacing="0" class="fsos-card" style="width:100%;max-width:${L.maxWidth}px;background:${C.surface};border-radius:${L.radius}px;border-top:4px solid ${C.brand};overflow:hidden;">
        ${headerHtml()}
        <tr><td class="fsos-pad" style="padding:24px 36px 8px;">
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
  return `<tr><td class="fsos-pad" style="background:${C.canvas};border-top:1px solid ${C.border};padding:22px 36px 30px;">
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
  return `<tr><td class="fsos-pad" style="background:${C.canvas};border-top:1px solid ${C.border};padding:22px 36px 30px;">
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
//
// Every stored campaign body (seed migrations, library blueprints, FSA-authored, AI) is
// personalized plain text. This section parses that plain text into the SAME premium
// component vocabulary the react-email templates use (eyebrow → H1 → lead → body, icon
// bullet lists, bulletproof CTA buttons, a styled sign-off, and fine-print disclaimers) so
// EVERY outbound campaign email is elite and on-brand — at the single send choke-point
// (CLAUDE.md §6), without touching the approval-gated copy (only its presentation).
//
// Contract: recipient merge values were HTML-escaped upstream (personalize {escapeHtml:true})
// and the remaining static text is trusted approval-gated author content, so this layer does
// NOT re-escape — it only structures + linkifies (re-escaping would double-escape the values).

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

// ── Premium body primitives (string mirrors of src/emails/_components.tsx) ────
// These render already-escaped, trusted author text — they do NOT re-escape (see contract
// above). They mirror the react-email primitives 1:1 so both surfaces share one design.

/** The warm personalized greeting line ("Hi {name},"). */
function mktGreeting(html: string): string {
  return `<p style="margin:0 0 12px;color:${C.ink};font-size:${T.body}px;line-height:1.6;font-weight:600;">${linkify(html).replace(/\n/g, '<br>')}</p>`
}

/** Emphasized lead paragraph (the opening line under the headline). */
function mktLead(html: string): string {
  return `<p style="margin:0 0 16px;color:${C.body};font-size:${T.lead}px;line-height:1.65;">${linkify(html).replace(/\n/g, '<br>')}</p>`
}

/** Standard body paragraph. */
function mktParagraph(html: string): string {
  return `<p style="margin:0 0 16px;color:${C.body};font-size:${T.body}px;line-height:1.7;">${linkify(html).replace(/\n/g, '<br>')}</p>`
}

/** Icon bullet list — a scannable, brand-marked list (table-based; no <ul> client quirks). */
function mktBulletList(items: string[]): string {
  const rows = items
    .map(
      (it) => `<tr>
        <td style="padding:5px 12px 5px 0;vertical-align:top;width:20px;color:${C.brand};font-size:${T.body}px;line-height:1.6;font-weight:700;">&bull;</td>
        <td style="padding:5px 0;vertical-align:top;color:${C.body};font-size:${T.body}px;line-height:1.6;">${linkify(it)}</td>
      </tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 18px;">${rows}</table>`
}

/**
 * Bulletproof primary CTA button (VML shim for Outlook). `href` and `label` are already
 * escaped upstream, so — unlike the transactional {@link buttonHtml} — this does NOT re-escape
 * (that would corrupt an href whose query string was escaped to `&amp;`).
 */
function mktButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;">
    <tr><td align="center" bgcolor="${C.brand}" style="border-radius:8px;">
      <!--[if mso]>&nbsp;<![endif]-->
      <a href="${href}" style="display:inline-block;background:${C.brand};color:${C.white};font-size:${T.body}px;font-weight:700;line-height:20px;text-decoration:none;padding:14px 32px;border-radius:8px;">${label}</a>
      <!--[if mso]>&nbsp;<![endif]-->
    </td></tr>
  </table>`
}

/** Format a stored dash phone ("954-756-2609") for display as "(954) 756-2609". */
function fmtPhone(p: string): string {
  const d = String(p ?? '').replace(/\D/g, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p
}

/** A labeled contact row inside the signature (e.g. "Cell  (954) 756-2609"). */
function sigContactRow(label: string, value: string, href: string): string {
  return `<tr>
      <td style="padding:2px 0;font-size:${T.small}px;line-height:1.6;color:${C.muted};width:52px;font-weight:700;">${label}</td>
      <td style="padding:2px 0;font-size:${T.small}px;line-height:1.6;"><a href="${href}" style="color:${C.body};text-decoration:none;">${value}</a></td>
    </tr>`
}

/** A green-zone signature action link ("Schedule a Meeting with Me" / "Get a Free Quote"). */
function sigActionLink(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;margin:0 0 6px;color:${C.primary};font-size:${T.small}px;font-weight:700;text-decoration:none;border-bottom:1px solid ${C.accent};padding-bottom:1px;">${esc(label)}&nbsp;&rarr;</a><br>`
}

/**
 * The FSA's standard signature FOOTPRINT (DESIGN.md §31.2): practice tagline, offerings list,
 * and required disclosures (FINRA/SIPC securities disclosure + confidentiality). Static, trusted
 * constants from EMAIL_SIGNATURE, so — unlike personalized body text — they ARE escaped here
 * (raw "&" in "FINRA & SIPC" must render as &amp;). Green-zone identity copy, never a
 * recommendation (§4.2); the CAN-SPAM footer with the mailing address + unsubscribe still follows.
 */
function signatureFootprintHtml(): string {
  const f = SIG.footprint
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;border-top:1px solid ${C.border};">
      <tr><td style="padding-top:14px;">
        <p style="margin:0 0 10px;color:${C.brand};font-size:${T.small}px;line-height:1.6;font-style:italic;">${esc(f.tagline)}</p>
        <p style="margin:0 0 6px;color:${C.body};font-size:${T.fine}px;line-height:1.6;"><strong style="color:${C.ink};">Offering:</strong> ${esc(f.offering)}</p>
        <p style="margin:0 0 10px;color:${C.muted};font-size:${T.micro}px;line-height:1.6;">${esc(f.securities)}</p>
        <p style="margin:0;color:${C.faint};font-size:${T.micro}px;line-height:1.6;">${esc(f.confidentiality)}</p>
      </td></tr>
    </table>`
}

/**
 * The rich, branded FSA email signature block (DESIGN.md §31.2): a headshot letterhead, the
 * agent name + designation, descriptive title + financial firm, direct/office/email contact
 * rows, two green-zone action links (booking + free quote), and the standard footprint
 * (tagline + offerings + disclosures). One canonical identity from EMAIL_SIGNATURE
 * (src/lib/email/brand.ts) so every campaign email signs off identically. The `closer`
 * (e.g. "Warm regards,") is the message's own approved sign-off word, kept verbatim.
 */
function signatureBlockHtml(closer: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid ${C.border};">
      <tr><td style="padding-top:18px;">
        <p style="margin:0 0 14px;color:${C.body};font-size:${T.body}px;line-height:1.5;">${closer}</p>
        <img src="${SIG.headshotUrl}" alt="${esc(SIG.name)}" width="${SIG.headshotSize}" height="${SIG.headshotSize}" style="display:block;border:0;outline:none;text-decoration:none;border-radius:12px;margin:0 0 14px;">
        <p style="margin:0;color:${C.brand};font-size:${T.h2}px;font-weight:700;line-height:1.35;">${esc(SIG.name)}<span style="color:${C.ink};font-weight:700;">, ${esc(SIG.credential)}</span></p>
        <p style="margin:2px 0 0;color:${C.muted};font-size:${T.small}px;line-height:1.5;">${esc(SIG.title)}</p>
        <p style="margin:2px 0 12px;color:${C.brand};font-size:${T.body}px;font-weight:700;line-height:1.5;">${esc(SIG.firm)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
          ${sigContactRow('Cell', fmtPhone(SIG.cell), SIG.cellHref)}
          ${sigContactRow('Office', fmtPhone(SIG.office), SIG.officeHref)}
          ${sigContactRow('Email', esc(SIG.email), SIG.emailHref)}
        </table>
        ${sigActionLink('Schedule a Meeting with Me', SIG.bookingUrl)}
        ${sigActionLink('Get a Free Quote', SIG.quoteUrl)}
      </td></tr>
    </table>
    ${signatureFootprintHtml()}`
}

// ── Block classification ─────────────────────────────────────────────────────

const GREETING_RE = /^(hi|hello|hey|dear|good (?:morning|afternoon|evening))\b/i
const CLOSER_RE = /^(sincerely|warm regards|warmly|kind regards|best regards|best wishes|respectfully|cordially|regards|thank you|with (?:gratitude|appreciation)),/i
const DISCLAIMER_RE = /^(this (?:email|message|communication|information)|any (?:recommendation|discussion|personalized|specific)|for educational|availability of policy)/i
// A CTA is a single short line: "Some Label https://…" (label ≤ 64 chars, URL at the end).
const CTA_RE = /^(\S.{0,63}?)\s+(https?:\/\/[^\s<>()"']+)$/

/** Split a body into paragraph blocks (blank-line separated), preserving intra-block newlines. */
function toBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
}

/** Extract the leading "Subject:" / "Preview:" header lines; return them + the remaining body. */
function parseHeaders(raw: string): { subject: string | null; preview: string | null; rest: string } {
  const lines = String(raw ?? '').replace(/\r\n/g, '\n').split('\n')
  let subject: string | null = null
  let preview: string | null = null
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*$/.test(line)) continue
    const ms = line.match(/^\s*subject:\s*(.*)$/i)
    if (ms) {
      subject = ms[1].trim() || null
      continue
    }
    const mp = line.match(/^\s*preview:\s*(.*)$/i)
    if (mp) {
      preview = mp[1].trim() || null
      continue
    }
    break
  }
  return { subject, preview, rest: lines.slice(i).join('\n').trim() }
}

interface RenderedBody {
  /** The email subject surfaced as the card H1 (from the body's own "Subject:" line). */
  heading: string | null
  /** The inbox preheader from the body's own "Preview:" line, if present. */
  preview: string | null
  /** The composed premium body HTML. */
  html: string
  /** Whether the body carried its own sign-off (so the shell must NOT append a duplicate). */
  hasSignoff: boolean
}

/**
 * Parse a personalized plain-text campaign body into premium, component-based HTML. Recognizes
 * the consistent structure of the stored campaign copy (greeting, paragraphs, "* " bullet lists,
 * "Label <url>" CTAs, "Warm regards, …" sign-offs, and trailing educational disclaimers) and
 * renders each with the shared brand vocabulary. Copy is never altered — only its presentation.
 */
function renderMarketingBody(body: string): RenderedBody {
  const { subject, preview, rest } = parseHeaders(body)
  const blocks = toBlocks(rest)
  const parts: string[] = []
  let hasSignoff = false
  let leadEmitted = false

  blocks.forEach((block, idx) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)

    // Bullet list — a block whose every line is a "* " / "- " / "• " item (lead-in lines sit in
    // their own preceding block, per the stored copy's blank-line structure).
    const bulletLines = lines.filter((l) => /^([*•]|-)\s+/.test(l))
    if (bulletLines.length >= 2 && bulletLines.length === lines.length) {
      parts.push(mktBulletList(lines.map((l) => l.replace(/^([*•]|-)\s+/, ''))))
      return
    }

    // CTA — a single short "Label <absolute-url>" line becomes a bulletproof button.
    if (lines.length === 1) {
      const cta = lines[0].match(CTA_RE)
      if (cta) {
        parts.push(mktButton(cta[1].trim(), cta[2]))
        return
      }
    }

    // Sign-off — "Warm regards, {name} …" → the rich branded signature block, keeping the
    // message's own approved closer word (dedupe: the shell appends no signature after).
    const closer = block.match(CLOSER_RE)
    if (closer) {
      hasSignoff = true
      parts.push(signatureBlockHtml(`${closer[1]},`))
      return
    }

    // Trailing per-campaign educational disclaimer → superseded by the standard signature
    // footprint (securities + confidentiality) and the CAN-SPAM footer (the required
    // "educational / not a product recommendation or suitability determination" line + mailing
    // address + unsubscribe). Detected so it is NOT rendered as a body paragraph, then dropped to
    // avoid a duplicate disclaimer block — the core disclosures are retained by those two surfaces.
    if (DISCLAIMER_RE.test(block)) {
      return
    }

    // Greeting (first body block) → warm greeting line; a standalone "Hi {name}," lets the
    // next paragraph carry the lead, while a merged "Hi {name}, {opener}" IS the lead.
    if (idx === 0 && GREETING_RE.test(block)) {
      const standalone = !block.includes('\n') && block.length <= 44 && /,\s*$/.test(block)
      if (standalone) {
        parts.push(mktGreeting(block))
        return
      }
      parts.push(mktLead(block))
      leadEmitted = true
      return
    }

    // First substantive paragraph → emphasized lead; subsequent paragraphs → body.
    if (!leadEmitted) {
      parts.push(mktLead(block))
      leadEmitted = true
      return
    }
    parts.push(mktParagraph(block))
  })

  return { heading: subject, preview, html: parts.join('\n'), hasSignoff }
}

export interface MarketingWrapOptions {
  /** Inbox preheader (typically the email subject). Overridden by a body "Preview:" line. */
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

  const rendered = renderMarketingBody(body)

  // Lead the card with the template's own Subject line as an H1 headline (premium hierarchy,
  // DESIGN.md §31). It is the template's approved copy surfaced as a heading — not new content.
  const heading = rendered.heading
    ? `<h1 style="margin:0 0 16px;color:${C.ink};font-size:${T.h1}px;line-height:1.28;font-weight:700;">${rendered.heading}</h1>`
    : ''

  // If the body carried its own sign-off, the parser already rendered the rich signature there
  // (no duplicate). Otherwise append the same branded signature so the message never ends
  // abruptly and every campaign email signs off identically.
  const fallbackSignoff = rendered.hasSignoff ? '' : signatureBlockHtml('Warm regards,')

  return chrome({
    preheader: rendered.preview ?? opts.preheader ?? undefined,
    innerHtml: `${heading}${rendered.html}\n${fallbackSignoff}`,
    footerHtml: marketingFooterHtml(unsub),
  })
}
