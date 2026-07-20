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
} as const

/** Verified business contact — Name / Address / Phone (NAP). */
export const CONTACT = {
  phoneDisplay: '361-717-4215',
  phoneE164: '+13617174215',
  email: 'mathelus@farmersagent.com',
  address: {
    line1: '12800 Westridge Blvd, Ste 114',
    city: 'Frisco',
    region: 'TX',
    postal: '75035',
    country: 'US',
  },
  hoursDisplay: 'Mon–Fri, 9:00 AM – 6:00 PM · Sat by appointment',
  serviceArea: 'Plano, Frisco, McKinney & surrounding areas',
  serviceAreaCities: ['Plano', 'Frisco', 'McKinney'],
} as const

/** License / registration designations shown in the footer + about. */
export const LICENSING = 'TX License 3081061 · Life, Health, Series 6, 26, 63'

/** Social links — only render the ones that are real (placeholders hidden). */
export const SOCIAL: { label: string; href: string }[] = [
  // Add verified profile URLs here; the footer renders social icons only when set.
]

/**
 * A2P 10DLC consent copy — a MIXED program (account/service + marketing). The
 * `version` is stored with every captured consent so we can prove exactly which
 * wording a contact agreed to. The sending number placeholder must be replaced
 * with the registered A2P number before launch (NEXT_PUBLIC_SMS_FROM).
 */
export const SMS_CONSENT = {
  version: 'a2p-10dlc-2026-07-frisco',
  program: 'Markist Athelus — Farmers Insurance — Customer & Account Messaging',
  from: process.env.NEXT_PUBLIC_SMS_FROM || '(XXX) XXX-XXXX',
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

/** The booking URL. Falls back to the on-page contact section when unset. */
export function bookingUrl(): string {
  return process.env.NEXT_PUBLIC_CALENDLY_URL || '/#contact'
}

/** Canonical site origin for metadata / structured data. */
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_URL ||
    'https://www.markistathelus.com'
  )
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
