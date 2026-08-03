// src/lib/email/brand.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the FSOS EMAIL design system (tokens + brand chrome).
//
// Email cannot resolve the app's CSS-variable design tokens (DESIGN.md) — every
// value must be a literal, inline color/size — so this file mirrors the DESIGN.md
// Farmers palette (§17.2 / §5.2) as concrete literals ONE time, and BOTH email
// rendering surfaces consume it so the two stay in lockstep:
//
//   1. The React Email campaign templates (author/build-time, ADR-025) under
//      src/emails/* — rendered to stored, immutable HTML+text.
//   2. The runtime transactional/operational HTML-string emails
//      (src/lib/notifications/*, src/lib/forms.ts, briefing) — plain strings, so
//      they can NEVER import react-email (ADR-025 keeps it a devDependency).
//
// It is pure data + pure string helpers (NO React, NO react-email, NO I/O) so it
// is safe to import from runtime code AND from the dev-only email templates. This
// is the "one design system, extended not cloned" rule (CLAUDE.md §6) applied to
// the two contexts email rendering unavoidably requires.
//
// Never hardcode an email color/spacing elsewhere — resolve it through EMAIL here.
import { BUSINESS, CONTACT, LICENSING, QUOTE_URL, HEADSHOT_PATH, SIGNATURE_FOOTPRINT } from '@/lib/site'

/**
 * Canonical marketing origin for absolutely-referenced email assets (the logo).
 * HARD-CODED (not env-derived) on purpose: the stored, approved email bytes must be
 * stable regardless of build environment (ADR-025 immutability) — an env-derived URL
 * would change render_sha per environment. Matches site.ts's canonical fallback.
 */
export const EMAIL_ORIGIN = 'https://www.markistfsa.com'

/**
 * Farmers palette as email-safe literals. Mirrors DESIGN.md §17.2 (official palette)
 * and §5.2 (implemented tokens). Divergences from the raw brand hex exist only to hold
 * WCAG 2.2 AA on email backgrounds and are documented inline.
 */
export const EMAIL_COLORS = {
  /** Farmers Blue (#1C428B) — primary brand, headings, primary CTA fill. */
  brand: '#1C428B',
  /** Premium Farmers blue (DESIGN.md --primary) — links / accents. */
  primary: '#2C4C9C',
  /** Pressed / gradient floor for the primary fill. */
  brandDeep: '#16305F',
  /** Deep marketing navy — footer band + darkest ink. */
  navy: '#0E2350',
  /** Light-blue accent (#A6C3E9) — hairline accents, soft rules. */
  accent: '#A6C3E9',
  /** Soft brand wash — callout / info-card background. */
  wash: '#EEF3FB',
  /** Farmers Red (AA-tuned) — critical alerts ONLY (never in green-zone body). */
  danger: '#B00020',
  /** Config-default "verify" gold (DESIGN.md guardrail) — assumption alerts. */
  gold: '#8A6D1F',
  goldWash: '#FBF3DA',
  /** Heading ink. */
  ink: '#14284F',
  /** Body ink. */
  body: '#3A4256',
  /** Muted / secondary text. */
  muted: '#6B7280',
  /** Fine print. */
  faint: '#8A94A6',
  /** Hairline borders / dividers. */
  border: '#E3E9F2',
  /** Page / canvas background behind the card. */
  canvas: '#EEF2F8',
  /** Card / content surface. */
  surface: '#FFFFFF',
  /** Header band surface (white so the color logo keeps contrast — §17.1). */
  header: '#FFFFFF',
  white: '#FFFFFF',
} as const

/** Web-safe, deterministic font stack (no webfont fetch — email-client safe). */
export const EMAIL_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** Type scale (px) — deliberate, small, email-legible hierarchy. */
export const EMAIL_TYPE = {
  eyebrow: 12,
  h1: 23,
  h2: 18,
  lead: 16,
  body: 15,
  small: 13,
  fine: 12,
  micro: 11,
} as const

/** Spacing scale (px). */
export const EMAIL_SPACE = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32, xxl: 40 } as const

/** Layout constants. */
export const EMAIL_LAYOUT = { maxWidth: 600, radius: 14, contentPad: 36 } as const

/**
 * Approved Farmers brand assets for email (raster — SVG is unreliable across email
 * clients; §17.1 requires approved assets, never a recreation). Absolute URLs so they
 * resolve in a delivered message. `alt` degrades gracefully when images are blocked.
 */
export const EMAIL_BRAND = {
  logoUrl: `${EMAIL_ORIGIN}/brand/farmers-logo.png`,
  logoAlt: `${BUSINESS.carrier}`,
  logoWidth: 132,
  logoHeight: 71,
} as const

/** Business identity re-exported for the shared footer (single source: site.ts). */
export const EMAIL_IDENTITY = {
  agent: BUSINESS.agent,
  title: BUSINESS.title,
  carrier: BUSINESS.carrier,
  brand: BUSINESS.brand,
  agency: BUSINESS.agency,
  licensing: LICENSING,
  phone: CONTACT.phoneDisplay,
  email: CONTACT.email,
  hours: CONTACT.hoursDisplay,
  /** Verified physical mailing address (CAN-SPAM sender identification). */
  mailingAddress: `${CONTACT.address.line1}, ${CONTACT.address.city}, ${CONTACT.address.region} ${CONTACT.address.postal}`,
} as const

/**
 * The rich EMAIL SIGNATURE identity (DESIGN.md §31.2). Single source: site.ts. Absolute URLs
 * (like the logo) so the headshot and links resolve in a delivered message, and stable/HARD-CODED
 * origin so the stored, approved bytes don't drift per environment (ADR-025). Both email surfaces
 * — the runtime campaign wrap (email-shell.ts) and the react-email templates (_components.tsx) —
 * render this ONE identity, so every FSA signature is byte-consistent.
 */
export const EMAIL_SIGNATURE = {
  name: BUSINESS.agent,
  credential: BUSINESS.credential,
  title: BUSINESS.titleLong,
  firm: BUSINESS.financialFirm,
  cell: CONTACT.cellDisplay,
  cellHref: `tel:${CONTACT.cellE164}`,
  office: CONTACT.phoneDisplay,
  officeHref: `tel:${CONTACT.phoneE164}`,
  email: CONTACT.email,
  emailHref: `mailto:${CONTACT.email}`,
  headshotUrl: `${EMAIL_ORIGIN}${HEADSHOT_PATH}`,
  headshotSize: 116,
  /** Native FSOS booking link ("Schedule a Meeting with Me"). */
  bookingUrl: `${EMAIL_ORIGIN}/schedule`,
  /** Public "Get a Free Quote" link (official Farmers agent page). */
  quoteUrl: QUOTE_URL,
  /** Standard footprint (tagline + offerings + required disclosures) — see site.ts. */
  footprint: SIGNATURE_FOOTPRINT,
} as const
