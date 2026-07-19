// src/lib/comms/personalize.ts
// Merge-token personalization for templates and campaigns. Tokens look like
// {{first_name}} and are replaced from a recipient context. Unknown tokens fall
// back to a safe neutral value (never a raw "{{token}}" leaking to a contact).
//
// This is content substitution only — it CANNOT introduce recommendation language
// (the gate still runs containsRecommendationLanguage on the final body), so
// personalization can never smuggle a red-line message past the guardrail.

export interface RecipientContext {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  agency_name?: string | null
  fsa_name?: string | null
  city?: string | null
}

const DEFAULTS: Record<string, string> = {
  first_name: 'there',
  last_name: '',
  full_name: 'there',
  agency_name: 'your Farmers agency',
  fsa_name: 'your Farmers Financial Services agent',
  city: 'your area',
}

function firstNameOf(ctx: RecipientContext): string {
  if (ctx.first_name) return ctx.first_name
  const full = (ctx.full_name || '').trim()
  return full ? full.split(/\s+/)[0] : ''
}

/** Replace every {{token}} in `body` using the recipient context + safe defaults. */
export function personalize(body: string, ctx: RecipientContext): string {
  const values: Record<string, string> = {
    first_name: firstNameOf(ctx) || DEFAULTS.first_name,
    last_name: (ctx.last_name || '').trim() || DEFAULTS.last_name,
    full_name: (ctx.full_name || '').trim() || firstNameOf(ctx) || DEFAULTS.full_name,
    agency_name: (ctx.agency_name || '').trim() || DEFAULTS.agency_name,
    fsa_name: (ctx.fsa_name || '').trim() || DEFAULTS.fsa_name,
    city: (ctx.city || '').trim() || DEFAULTS.city,
  }
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, token: string) => {
    const key = token.toLowerCase()
    return key in values ? values[key] : key in DEFAULTS ? DEFAULTS[key] : ''
  })
}

/** List the merge tokens referenced by a template body (for the editor UI). */
export function tokensIn(body: string): string[] {
  const found = new Set<string>()
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) found.add(m[1].toLowerCase())
  return [...found]
}
