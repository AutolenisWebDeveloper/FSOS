// Plain, server-and-client-safe contact metadata. This MUST NOT live in a
// 'use client' module: server components (e.g. the contact detail page) index
// into CONTACT_TYPE_LABEL directly, and dotting into a value imported from a
// client module throws at request time ("cannot dot into a client module from a
// server component"). Keep this a plain .ts value module so both sides can use it.

export const CONTACT_TYPE_LABEL: Record<string, string> = {
  agency_owner: 'Agency Owner',
  client: 'Client',
  prospect: 'Prospect',
  term_conversion: 'Term Conversion',
  cross_sell: 'Cross-Sell',
  business: 'Business Owner',
  unknown: 'Uncategorized',
}
