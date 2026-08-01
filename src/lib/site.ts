// src/lib/site.ts
// -----------------------------------------------------------------------------
// Single source of truth for the PUBLIC marketing surface (homepage, footer,
// legal pages, SMS terms, structured data, and the contact API).
//
// Values below come from the FSA's own authoritative content build. Verify
// against the registered Twilio A2P brand and current licensing before go-live.
// -----------------------------------------------------------------------------

/** The one business identity that must match the Twilio A2P brand registration. */
export const BUSINESS = {
  /** Legal / display name of the FSA. */
  agent: 'Markist Athelus',
  /** Professional designation. */
  title: 'Financial Services Agent',
  /** Carrier represented. */
  carrier: 'Farmers Insurance',
  /** Brand identity used in SMS sender identity + consent language. */
  brand: 'Markist Athelus — Farmers Insurance',
  /** Short brand used in the nav lockup. */
  short: 'Markist Athelus',
  /**
   * Registered agency display name (the "{{agency_name}}" merge token). Derived from
   * LEGAL_ENTITY — the Twilio-vetted registered entity, not invented data (§4.3).
   */
  agency: 'Markist Athelus Farmers Agency',
} as const

/** Verified business contact — Name / Address / Phone (NAP). */
export const CONTACT = {
  phoneDisplay: '361-717-4215',
  phoneE164: '+13617174215',
  email: 'mathelus@farmersagent.com',
  address: {
    // Primary / registered business address — reconciled to the Twilio-vetted
    // A2P Business Profile. This is the NAP that must match the brand registration.
    line1: '5830 Granite Parkway, Ste 100-356',
    city: 'Plano',
    region: 'TX',
    postal: '75024',
    country: 'US',
  },
  hoursDisplay: 'Mon–Fri, 9:00 AM – 6:00 PM · Sat by appointment',
  serviceArea: 'Plano, Frisco, McKinney & surrounding areas',
  serviceAreaCities: ['Plano', 'Frisco', 'McKinney'],
} as const

/** License / registration designations shown in the footer + about. */
export const LICENSING = 'TX License 3081061 · Life, Health, Series 6, 26, 63'

/**
 * Registered legal entity + DBA, reconciled to the Twilio-vetted A2P Business
 * Profile. Rendered in the footer legal block for business-identity disclosure.
 */
export const LEGAL_ENTITY =
  'Operated by Markist Athelus Farmers Agency (DBA markistfsa.com), a licensed insurance and financial-services sole proprietorship. Markist Athelus, agent appointed with Farmers Insurance · TX License 3081061.'

/** Social links — only render the ones that are real (placeholders hidden). */
export const SOCIAL: { label: string; href: string }[] = [
  // Add verified profile URLs here; the footer renders social icons only when set.
]

/**
 * Registered A2P 10DLC sending number for the SMS program. This is the origination
 * number ("Messages originate from …") and is DISTINCT from the office/contact
 * number (CONTACT.phoneDisplay). It appears only in SMS-origination disclosures.
 */
const SMS_FROM_NUMBER = '361-240-7449'

/**
 * A2P 10DLC consent copy — a purely INFORMATIONAL customer-care program (no
 * marketing or promotional messages; that requires separate consent per carrier
 * 30913). The `version` is stored with every captured consent, and `disclosure`
 * is the exact plain-text wording shown at the checkbox — the canonical record
 * persisted with each consent so we can prove exactly what the contact agreed to.
 * Keep `disclosure` verbatim-synced with the JSX label in SiteContactForm.
 */
export const SMS_CONSENT = {
  version: '2026-07-A-info',
  program: 'Markist Athelus — Farmers Insurance — Customer & Account Messaging',
  // Registered A2P 10DLC origination number (see SMS_FROM_NUMBER).
  from: SMS_FROM_NUMBER,
  // Canonical source of the captured consent record's sourceUrl (the homepage
  // contact anchor where the checkbox lives).
  sourceUrl: 'https://www.markistfsa.com/#contact',
  // Exact plain-text of the checkbox label shown to the user (informational,
  // customer-care only). MUST stay verbatim-synced with the rendered JSX label.
  disclosure:
    `By checking this box, I agree to receive recurring account and customer-service text messages from ${BUSINESS.brand} at the mobile number provided — including appointment scheduling and reminders, policy and account service updates, document or information requests, and replies to my inquiries. Messages originate from ${SMS_FROM_NUMBER}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase. See our Privacy Policy, Terms of Use, and SMS Terms & Conditions.`,
} as const

/** Canonical FSA authentication host (see loginUrl). */
export function authBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_AUTH_URL || 'https://fsos-seven.vercel.app').replace(/\/$/, '')
}

/** The FSA login URL. After sign-in the flow redirects to the FSA dashboard (`/app`). */
export function loginUrl(): string {
  return `${authBaseUrl()}/login?next=%2Fapp`
}

/** The FSA dashboard URL. */
export function dashboardUrl(): string {
  return `${authBaseUrl()}/app`
}

/** The booking URL — the native FSOS scheduler (Calendly replacement, ADR-027). */
export function bookingUrl(): string {
  return '/schedule'
}

/**
 * The advisor + agency identity merge tokens shared by every outbound message (§13/§17).
 * These are single-FSA constants, so the send path (sendThroughGate) injects them as
 * CALLER-OVERRIDABLE defaults — a campaign or booking send inherits correct advisor identity,
 * agency identity, and an ABSOLUTE scheduling link without each call site re-specifying them,
 * while a caller that needs a different value (e.g. an on-behalf-of send naming a partner
 * agency) still wins by passing its own recipientContext. All are BLOCKING-tier tokens: if one
 * somehow fails to resolve, the send is blocked rather than shipping empty identity.
 */
export function advisorMergeContext(): {
  fsa_name: string
  agency_name: string
  advisor_phone: string
  advisor_email: string
  scheduling_link: string
} {
  return {
    fsa_name: BUSINESS.agent,
    agency_name: BUSINESS.agency,
    advisor_phone: CONTACT.phoneDisplay,
    advisor_email: CONTACT.email,
    // Absolute booking link — the relative bookingUrl() ('/schedule') breaks in a delivered email.
    scheduling_link: `${siteUrl()}/schedule`,
  }
}

/** Canonical site origin for metadata / structured data. */
export function siteUrl(): string {
  const fallback = 'https://www.markistfsa.com'
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_URL ||
    fallback
  // Never return a value `new URL()` can't parse: `metadataBase` (root layout)
  // and the structured-data builder both wrap this in `new URL(...)`, so a
  // schemeless / malformed env value (e.g. "fsos-seven.vercel.app") would throw
  // at build time and fail every route. Validate, normalize, and fall back.
  try {
    return new URL(configured).toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

/** Compliance disclosure lines — reused by the footer and legal pages. */
export const DISCLOSURES = {
  practice:
    'Markist Athelus is a licensed Financial Services Agent representing Farmers Insurance and its affiliated companies. This website is for general information and to request contact with the agency; it is not an offer of insurance and does not amend or modify any policy. Coverage and financial products are subject to underwriting, eligibility, availability, and the terms of the issued policy or contract.',
  securities:
    'Securities offered through Farmers Financial Solutions, LLC, 30700 Russell Ranch Road #214, Westlake Village, CA 91362. Member FINRA & SIPC. Investing involves risk, including the possible loss of principal. Life insurance issued by Farmers New World Life Insurance Company, 3120 139th Ave. SE, Ste. 300, Bellevue, WA 98005.',
  mobile:
    'No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. All other categories of data exclude text messaging originator opt-in data and consent; this information will not be shared with any third parties.',
} as const
