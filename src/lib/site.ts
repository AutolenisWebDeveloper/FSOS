// src/lib/site.ts
// -----------------------------------------------------------------------------
// Single source of truth for the PUBLIC marketing surface (homepage, footer,
// legal pages, SMS terms, structured data, and the contact API).
//
// Everything a compliance reviewer or the FSA might need to correct lives here —
// the business name/address/phone (NAP), service area, disclosures, and the
// exact A2P 10DLC SMS consent wording — so it is edited in ONE place and stays
// identical across the site, the Privacy Policy, the SMS Terms, and the Twilio
// campaign registration (a hard A2P requirement: the business identity must not
// drift between surfaces).
//
// These are editable defaults, sourced from the FSA's provided design and the
// repo's existing disclosure language. Verify against the registered Twilio
// brand and current licensing before go-live (see the homepage report).
// -----------------------------------------------------------------------------

/** The one business identity that must match the Twilio A2P brand registration. */
export const BUSINESS = {
  /** Legal / display name of the FSA. */
  agent: 'Markist Athelus',
  /** Professional designation. */
  title: 'Farmers Financial Services Agent',
  /** DBA / brand identity used in SMS sender identity + consent language. */
  brand: 'Markist Financial Services',
  /** Short brand used in the nav lockup. */
  short: 'Markist Athelus',
} as const

/** Verified business contact — Name / Address / Phone (NAP). */
export const CONTACT = {
  phoneDisplay: '(469) 535-1111',
  phoneE164: '+14695351111',
  email: 'mathelus@farmersagent.com',
  address: {
    line1: '6005 W Park Blvd, Ste 206',
    city: 'Plano',
    region: 'TX',
    postal: '75093',
    country: 'US',
  },
  hoursDisplay: 'Mon–Fri, 9:00 AM – 6:00 PM · Sat by appointment',
  serviceArea: 'Serving Plano, Frisco, McKinney & surrounding areas',
  serviceAreaCities: ['Plano', 'Frisco', 'McKinney', 'Allen', 'Dallas'],
} as const

/** License / registration designations shown in the footer. VERIFY before go-live. */
export const LICENSING = 'TX License: Life & Health · Securities registrations Series 6, 26, 63'

/** Social links — only render the ones that are real. */
export const SOCIAL: { label: string; href: string }[] = [
  // Add verified profile URLs here; the footer renders none if this is empty.
]

/**
 * A2P 10DLC consent copy. The `version` is stored with every captured consent so
 * we can prove exactly which wording a contact agreed to. Bump the version if the
 * text below changes.
 */
export const SMS_CONSENT = {
  version: 'a2p-10dlc-2026-07',
  label: `By checking this box, I agree to receive SMS messages from ${BUSINESS.agent} / ${BUSINESS.brand} regarding appointments, requested information, service updates, account servicing, and customer support. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent is not a condition of purchase.`,
} as const

/** The booking URL. Falls back to the public workshops index when unset. */
export function bookingUrl(): string {
  return process.env.NEXT_PUBLIC_CALENDLY_URL || '/events'
}

/** True when a real Calendly URL is configured (vs. the /events fallback). */
export function hasCalendly(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CALENDLY_URL)
}

/** Canonical site origin for metadata / structured data. */
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_URL ||
    'https://markistfinancial.com'
  )
}

/** Compliance disclosure lines — reused by the footer and the disclosures page. */
export const DISCLOSURES = {
  securities:
    'Securities offered through Farmers Financial Solutions, LLC (FFS), 31051 Agoura Road, Westlake Village, CA 91361. Member FINRA & SIPC.',
  life: 'Life insurance issued by Farmers New World Life Insurance Company (FNWL) and other carriers, subject to issuing-company rules and applicable state regulation.',
  advice:
    'Information on this site is general and educational only — not individualized investment, tax, legal, or insurance advice. Any recommendation is made personally by a licensed professional through the appropriate supervised channel. Products and services are not available in all states.',
  notFarmers:
    'This is the professional practice of an independent Farmers Financial Services Agent. The FSOS client platform is the practice’s own technology and is not owned or operated by Farmers.',
} as const
