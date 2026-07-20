// src/lib/zoom/client.ts
// Zoom REST client for per-registrant provisioning (spec §A). Server-to-Server OAuth
// (account_credentials) → create a meeting/webinar registrant → return the per-registrant
// join_url + Zoom registrant id (stored for webhook correlation).
//
// CREDENTIAL-GATED, GRACEFUL DEGRADATION — mirrors ghlEnabled() (src/lib/ghl.ts). With no
// ZOOM_* env vars set the whole integration is a clean no-op: zoomEnabled() is false,
// provisioning is skipped, registration still succeeds, and the join_url is provisioned
// later on retry (never lost). No provider SDK is used; only fetch. No securities data is
// ever sent to Zoom — provisioning transmits name + email only (guardrail 1).
//
// Env vars (see .env.local.example): ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
// (S2S OAuth app), ZOOM_WEBHOOK_SECRET_TOKEN (verification — used in ./webhook.ts).

const OAUTH_URL = 'https://zoom.us/oauth/token'
const API_BASE = 'https://api.zoom.us/v2'

/** True only when all three provisioning credentials are present. */
export function zoomEnabled(): boolean {
  return !!(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET)
}

// In-memory access-token cache (a bearer string + expiry — NOT a client instance, so the
// module-level-client rule does not apply). Refreshed lazily with a safety margin.
let cachedToken: { token: string; expiresAtMs: number } | null = null

async function getAccessToken(): Promise<string | null> {
  if (!zoomEnabled()) return null
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAtMs - 60_000 > now) return cachedToken.token

  const basic = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')
  const url = `${OAUTH_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID as string)}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
    })
    if (!res.ok) {
      console.error('[zoom] oauth token error:', res.status, await safeText(res))
      return null
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) return null
    cachedToken = {
      token: body.access_token,
      expiresAtMs: now + (body.expires_in ?? 3600) * 1000,
    }
    return cachedToken.token
  } catch (err) {
    console.error('[zoom] oauth token fetch failed:', err)
    return null
  }
}

export interface ZoomRegistrantInput {
  meetingId: string
  kind?: 'meeting' | 'webinar'
  email: string
  firstName: string
  lastName?: string | null
}

export interface ZoomRegistrantResult {
  ok: boolean
  registrantId?: string | null
  joinUrl?: string | null
  error?: string
}

/**
 * Create a per-registrant Zoom registration and return the personalized join_url + the
 * Zoom-issued registrant id (stored for webhook correlation). Best-effort: returns
 * { ok:false, error } on any failure so the caller can leave the registration intact and
 * retry later — the registration itself is NEVER blocked on Zoom.
 */
export async function addZoomRegistrant(inp: ZoomRegistrantInput): Promise<ZoomRegistrantResult> {
  if (!zoomEnabled()) return { ok: false, error: 'zoom_disabled' }
  if (!inp.meetingId) return { ok: false, error: 'no_meeting_id' }
  const token = await getAccessToken()
  if (!token) return { ok: false, error: 'no_access_token' }

  const path = inp.kind === 'webinar' ? `webinars/${inp.meetingId}/registrants` : `meetings/${inp.meetingId}/registrants`
  try {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // Name + email ONLY — never any securities/financial data (guardrail 1).
      body: JSON.stringify({
        email: inp.email,
        first_name: inp.firstName || 'Guest',
        last_name: inp.lastName || undefined,
      }),
    })
    if (!res.ok) {
      return { ok: false, error: `zoom_${res.status}: ${await safeText(res)}` }
    }
    const body = (await res.json()) as { registrant_id?: string; id?: string | number; join_url?: string }
    return {
      ok: true,
      registrantId: body.registrant_id ?? (body.id != null ? String(body.id) : null),
      joinUrl: body.join_url ?? null,
    }
  } catch (err) {
    return { ok: false, error: `zoom_fetch_failed: ${(err as Error).message}` }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}
