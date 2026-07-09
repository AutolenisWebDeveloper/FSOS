// src/lib/apollo.ts
// Thin, fully-guarded Apollo.io People-Enrichment client. No-ops when
// APOLLO_API_KEY is unset so the rest of the app keeps working without it.

const APOLLO_BASE = 'https://api.apollo.io/api/v1'

export function apolloEnabled(): boolean {
  return !!process.env.APOLLO_API_KEY
}

export interface EnrichedPerson {
  title: string | null
  headline: string | null
  company: string | null
  industry: string | null
  linkedin_url: string | null
  city: string | null
  state: string | null
  seniority: string | null
  employment_history_count: number | null
}

export interface EnrichResult {
  ok: boolean
  status: number
  person?: EnrichedPerson
  error?: string
  skipped?: boolean
}

/**
 * Enrich a person via Apollo's people/match endpoint. Matches on email (best),
 * else first+last (+ optional org). Returns a compact, display-safe subset.
 */
export async function enrichPerson(input: {
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  organization?: string | null
}): Promise<EnrichResult> {
  const key = process.env.APOLLO_API_KEY
  if (!key) return { ok: false, status: 0, skipped: true, error: 'Apollo not configured' }
  if (!input.email && !(input.firstName && input.lastName)) {
    return { ok: false, status: 400, error: 'Need an email or first+last name to enrich' }
  }

  const body: Record<string, unknown> = {}
  if (input.email) body.email = input.email
  if (input.firstName) body.first_name = input.firstName
  if (input.lastName) body.last_name = input.lastName
  if (input.organization) body.organization_name = input.organization

  try {
    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      /* non-JSON */
    }
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (json as any).person
    if (!p) return { ok: true, status: res.status, person: undefined, error: 'No match found' }

    const org = p.organization || {}
    const person: EnrichedPerson = {
      title: p.title || null,
      headline: p.headline || null,
      company: org.name || p.organization_name || null,
      industry: org.industry || null,
      linkedin_url: p.linkedin_url || null,
      city: p.city || null,
      state: p.state || null,
      seniority: p.seniority || null,
      employment_history_count: Array.isArray(p.employment_history) ? p.employment_history.length : null,
    }
    return { ok: true, status: res.status, person }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
