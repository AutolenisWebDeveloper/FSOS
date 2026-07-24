// YouTube adapter (ADR-026, Slice 3). The first ACTIVE publisher — YouTube's Data
// API is the least restricted, so it proves the pipeline end to end.
//
// A YouTube "post" is a video upload (videos.insert). The publish path is real but
// CREDENTIAL-GATED: with no connected account (no decrypted accessToken) the base
// class short-circuits to `not_configured` and never touches the network — which is
// exactly the state in any environment without YouTube OAuth (CI, tests, previews).
// Browser automation is never used.

import { BaseSocialPublisher } from './base'
import type { ChannelContext, PlatformSupport, PublishInput, PublishResult, SocialPlatform } from './types'

const YOUTUBE_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'

export class YouTubePublisher extends BaseSocialPublisher {
  readonly platform: SocialPlatform = 'youtube'
  protected readonly support: PlatformSupport = {
    canPost: true,
    canReadEngagement: true,
    canReadAnalytics: true,
    active: true,
  }

  async publish(input: PublishInput, channel: ChannelContext): Promise<PublishResult> {
    // Not configured / no credential → deterministic inert result (no network).
    if (!this.isConfigured(channel) || !channel.accessToken) {
      return { ok: false, error: { code: 'not_configured', message: this.notConfiguredReason(channel), retryable: false } }
    }
    // A YouTube post requires a video asset. Without one it is invalid content
    // (a terminal, non-retryable error — do not dead-letter-retry it forever).
    const videoUrl = (input.mediaUrls ?? []).find(Boolean)
    if (!videoUrl) {
      return {
        ok: false,
        error: { code: 'invalid_content', message: 'YouTube requires a video asset to publish.', retryable: false },
      }
    }

    try {
      // 1. Fetch the video bytes from our own stored media reference.
      const media = await fetch(videoUrl)
      if (!media.ok) {
        return {
          ok: false,
          error: { code: 'invalid_content', message: `Could not read media (${media.status}).`, retryable: false },
        }
      }
      const bytes = await media.arrayBuffer()

      // 2. Initiate a resumable upload with the snippet/status metadata.
      const init = await fetch(YOUTUBE_UPLOAD_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${channel.accessToken}`,
          'content-type': 'application/json',
          'x-upload-content-type': media.headers.get('content-type') || 'video/*',
        },
        body: JSON.stringify({
          snippet: { title: (input.title || input.body || 'Untitled').slice(0, 100), description: input.body || '' },
          status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
        }),
      })
      if (!init.ok) return { ok: false, error: this.normalizeHttp(init.status, await safeText(init)) }
      const uploadUrl = init.headers.get('location')
      if (!uploadUrl) {
        return { ok: false, error: { code: 'platform_error', message: 'No resumable upload URL returned.', retryable: true } }
      }

      // 3. Upload the bytes; the response carries the created video id.
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { authorization: `Bearer ${channel.accessToken}` },
        body: bytes,
      })
      if (!put.ok) return { ok: false, error: this.normalizeHttp(put.status, await safeText(put)) }
      const json = (await put.json().catch(() => ({}))) as { id?: string }
      if (!json.id) {
        return { ok: false, error: { code: 'platform_error', message: 'Upload succeeded but no video id returned.', retryable: true } }
      }
      return { ok: true, platformPostId: json.id, raw: json }
    } catch (err) {
      // Network / fetch failure → retryable.
      return { ok: false, error: { code: 'network', message: err instanceof Error ? err.message : 'Network error', retryable: true } }
    }
  }

  private normalizeHttp(status: number, body: string) {
    if (status === 401 || status === 403) return { code: 'auth' as const, message: `YouTube auth failed (${status}).`, retryable: false, raw: body }
    if (status === 429) return { code: 'rate_limited' as const, message: 'YouTube rate limit.', retryable: true, raw: body }
    if (status >= 500) return { code: 'platform_error' as const, message: `YouTube server error (${status}).`, retryable: true, raw: body }
    return { code: 'platform_error' as const, message: `YouTube error (${status}).`, retryable: false, raw: body }
  }
}

async function safeText(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 500)
  } catch {
    return ''
  }
}
