// src/lib/zoom/client.ts
// Zoom REST client for per-registrant provisioning (spec §A). Server-to-Server OAuth
// (account_credentials) → create a meeting/webinar registrant → return the per-registrant
// join_url + Zoom registrant id (stored for webhook correlation).
//
// CREDENTIAL-GATED, GRACEFUL DEGRADATION — the standard FSOS integration pattern. With no
// ZOOM_* env vars set the whole integration is a clean no-op: zoomEnabled() is false,
// provisioning is skipped, registration still succeeds, and the join_url is provisioned
// later on retry (never lost). No provider SDK is used; only fetch. No securities data is
// ever sent to Zoom — provisioning transmits name + email only (guardrail 1).
//
// Env vars (see .env.local.example): ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
// (S2S OAuth app), ZOOM_WEBHOOK_SECRET_TOKEN (verification — used in ./webhook.ts).

const OAUTH_URL = 'https://zoom.us/oauth/token'
const API_BASE = 'https://api.zoom.us/v2'

// WS-059: every Zoom fetch is bounded — provisioning runs inside the public register
// request, so a hung Zoom API must never stall a registrant's response.
const ZOOM_FETCH_TIMEOUT_MS = 5000

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
      signal: AbortSignal.timeout(ZOOM_FETCH_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(ZOOM_FETCH_TIMEOUT_MS),
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

export interface ZoomMeetingInput {
  topic: string
  /** UTC ISO start instant. */
  startTime: string
  durationMinutes: number
  /** IANA zone for display in Zoom (start_time is sent in UTC and is unambiguous). */
  timezone?: string
}

export interface ZoomMeetingResult {
  ok: boolean
  meetingId?: string | null
  /** Zoom meeting UUID (distinct from the numeric id) — webhook/report correlation. */
  uuid?: string | null
  /** Attendee link — safe to send to the client. */
  joinUrl?: string | null
  /** HOST link — FSA-only. NEVER return this to a client or write it to a log. */
  startUrl?: string | null
  /** Meeting passcode. */
  passcode?: string | null
  dialIn?: string | null
  error?: string
}

/**
 * Create a scheduled Zoom meeting for a booking (spec §5, Slice 4). Reuses the same S2S
 * OAuth + zoomEnabled() gate as the registrant path — no new integration, no new env vars.
 * Best-effort: returns { ok:false, error } on any failure (including zoom_disabled) so the
 * caller can complete the booking and provision later, exactly like the workshop retry. No
 * securities/financial data is sent — only the meeting topic + times.
 */
export async function createZoomMeeting(inp: ZoomMeetingInput): Promise<ZoomMeetingResult> {
  if (!zoomEnabled()) return { ok: false, error: 'zoom_disabled' }
  const token = await getAccessToken()
  if (!token) return { ok: false, error: 'no_access_token' }

  const userId = process.env.ZOOM_USER_ID || 'me'
  // Zoom wants start_time without milliseconds (yyyy-MM-ddTHH:mm:ssZ).
  const startIso = new Date(inp.startTime).toISOString().replace(/\.\d{3}Z$/, 'Z')
  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/meetings`, {
      signal: AbortSignal.timeout(ZOOM_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: inp.topic.slice(0, 200),
        type: 2, // scheduled meeting
        start_time: startIso,
        duration: inp.durationMinutes,
        timezone: inp.timezone || 'UTC',
        // A 1:1 booking joins via join_url (no registration). Waiting room on by default.
        settings: { join_before_host: false, waiting_room: true, approval_type: 2 },
      }),
    })
    if (!res.ok) return { ok: false, error: `zoom_${res.status}: ${await safeText(res)}` }
    const body = (await res.json()) as {
      id?: string | number
      uuid?: string
      join_url?: string
      start_url?: string
      password?: string
      settings?: { global_dial_in_numbers?: { number?: string }[] }
    }
    return {
      ok: true,
      meetingId: body.id != null ? String(body.id) : null,
      uuid: body.uuid ?? null,
      joinUrl: body.join_url ?? null,
      startUrl: body.start_url ?? null,
      passcode: body.password ?? null,
      dialIn: body.settings?.global_dial_in_numbers?.[0]?.number ?? null,
    }
  } catch (err) {
    return { ok: false, error: `zoom_fetch_failed: ${(err as Error).message}` }
  }
}

export interface ZoomMutationResult {
  ok: boolean
  /** True when Zoom is unconfigured — a clean no-op, not a failure (caller proceeds). */
  skipped?: boolean
  error?: string
}

/**
 * Update a scheduled meeting's time/duration (reschedule, Slice 6). PATCH /meetings/{id}
 * returns 204 on success. Gated + best-effort: `{ ok:true, skipped:true }` when Zoom is
 * unconfigured or the appointment has no meeting id, so a reschedule never fails on Zoom.
 */
export async function updateZoomMeeting(
  meetingId: string | null | undefined,
  inp: { startTime: string; durationMinutes: number; topic?: string; timezone?: string },
): Promise<ZoomMutationResult> {
  if (!zoomEnabled()) return { ok: true, skipped: true }
  if (!meetingId) return { ok: true, skipped: true }
  const token = await getAccessToken()
  if (!token) return { ok: false, error: 'no_access_token' }
  const startIso = new Date(inp.startTime).toISOString().replace(/\.\d{3}Z$/, 'Z')
  try {
    const res = await fetch(`${API_BASE}/meetings/${encodeURIComponent(meetingId)}`, {
      signal: AbortSignal.timeout(ZOOM_FETCH_TIMEOUT_MS),
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_time: startIso,
        duration: inp.durationMinutes,
        ...(inp.topic ? { topic: inp.topic.slice(0, 200) } : {}),
        timezone: inp.timezone || 'UTC',
      }),
    })
    if (!res.ok) return { ok: false, error: `zoom_${res.status}: ${await safeText(res)}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `zoom_fetch_failed: ${(err as Error).message}` }
  }
}

/**
 * Delete a scheduled meeting (cancel, Slice 6). DELETE /meetings/{id} returns 204; a 404 is
 * treated as success (already gone). Gated + best-effort like updateZoomMeeting.
 */
export async function deleteZoomMeeting(meetingId: string | null | undefined): Promise<ZoomMutationResult> {
  if (!zoomEnabled()) return { ok: true, skipped: true }
  if (!meetingId) return { ok: true, skipped: true }
  const token = await getAccessToken()
  if (!token) return { ok: false, error: 'no_access_token' }
  try {
    const res = await fetch(`${API_BASE}/meetings/${encodeURIComponent(meetingId)}`, {
      signal: AbortSignal.timeout(ZOOM_FETCH_TIMEOUT_MS),
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok || res.status === 404) return { ok: true } // 404 = already deleted
    return { ok: false, error: `zoom_${res.status}: ${await safeText(res)}` }
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
