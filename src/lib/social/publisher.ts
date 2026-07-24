// Social publish job (ADR-026, Slice 3). Runs on the existing job path (Vercel
// cron → this function), never a browser session or client timer.
//
// Guarantees:
//   • EXACTLY ONCE — a conditional claim (pending → publishing) means only one
//     worker ever publishes a given entry; a lost race is a no-op.
//   • RETRY with exponential backoff + DEAD-LETTER — decided by planAfterAttempt.
//   • IMMUTABLE attempt records — every attempt appends to social_publish_log.
//   • not_configured HOLDS (does not dead-letter) so an account can be connected later.

import { getDb } from '@/lib/supabase/client'
import { getAdapter, type ChannelContext, type PublishInput } from './adapters'
import { socialTokenKey } from './secrets'
import { SCHEDULE_CHANNEL_SELECT } from './channel-view'
import { signMediaUrl } from './media-service'
import {
  parseCredential,
  credentialNeedsRefresh,
  serializeCredential,
  isOAuthPlatform,
  providerConfig,
} from './oauth'
import { refreshCredential } from './oauth-exchange'
import { planAfterAttempt, isDue, type SocialScheduleStatus } from './scheduling'

export interface PublishRunResult {
  processed: number
  published: number
  retriedOrHeld: number
  deadLettered: number
  skipped: number
}

interface DueRow {
  id: string
  version_id: string
  channel_id: string
  scheduled_at: string
  attempts: number
  next_attempt_at: string | null
}

export async function publishDueEntries(nowMs: number = Date.now()): Promise<PublishRunResult> {
  const db = getDb()
  const result: PublishRunResult = { processed: 0, published: 0, retriedOrHeld: 0, deadLettered: 0, skipped: 0 }

  const nowIso = new Date(nowMs).toISOString()
  const { data: candidates, error } = await db
    .from('social_schedule_entries')
    .select('id, version_id, channel_id, scheduled_at, attempts, next_attempt_at')
    .eq('status', 'pending')
    .is('deleted_at', null)
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(50)
  if (error) throw new Error(`social-publish: ${error.message}`)

  for (const entry of (candidates ?? []) as DueRow[]) {
    if (!isDue(Date.parse(entry.scheduled_at), entry.next_attempt_at ? Date.parse(entry.next_attempt_at) : null, nowMs)) {
      continue // backoff window not elapsed
    }

    // Atomic claim: only the worker that flips pending → publishing proceeds.
    const { data: claimed } = await db
      .from('social_schedule_entries')
      .update({ status: 'publishing', updated_by: 'system:social-publish' })
      .eq('id', entry.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claimed) {
      result.skipped++
      continue // lost the race — another worker owns it
    }
    result.processed++
    await publishClaimed(db, entry, nowMs, result)
  }

  return result
}

async function publishClaimed(
  db: ReturnType<typeof getDb>,
  entry: DueRow,
  nowMs: number,
  result: PublishRunResult,
): Promise<void> {
  // Load the frozen, approved version snapshot.
  const { data: version } = await db
    .from('social_content_versions')
    .select('id, content_id, snapshot, status')
    .eq('id', entry.version_id)
    .maybeSingle()

  // Load the channel and decrypt its OAuth secret SERVER-SIDE (never logged/exposed).
  // has_credential is a REAL generated column (mig 067) — a bare column, never a SQL
  // expression in the select string (PostgREST rejects expressions). secret_enc is
  // still never selected; the secret is read only via the pgcrypto RPC below.
  const { data: channelData } = await db
    .from('social_channels')
    .select(SCHEDULE_CHANNEL_SELECT)
    .eq('id', entry.channel_id)
    .maybeSingle()
  const channel = channelData as unknown as {
    id: string
    platform: ChannelContext['platform']
    external_account_id: string | null
    status: string
    token_expires_at: string | null
    has_credential: boolean | null
  } | null

  const platform = channel?.platform as ChannelContext['platform']
  let accessToken: string | undefined
  let tokenExpiresAt = channel?.token_expires_at ?? null
  if (channel?.has_credential) {
    const { data: secret } = await db.rpc('social_channel_secret', { p_channel: entry.channel_id, p_key: socialTokenKey() })
    let envelope = parseCredential((secret as string | null) ?? null)
    // Silently refresh an expiring credential before publishing (YouTube/Google).
    if (
      envelope &&
      isOAuthPlatform(platform) &&
      providerConfig(platform).supportsRefresh &&
      credentialNeedsRefresh(envelope, nowMs)
    ) {
      const refreshed = await refreshCredential(platform, envelope)
      if (refreshed) {
        await db.rpc('social_channel_set_secret', {
          p_channel: entry.channel_id,
          p_secret: serializeCredential(refreshed),
          p_key: socialTokenKey(),
        })
        await db.from('social_channels').update({ token_expires_at: refreshed.expiresAt ?? null }).eq('id', entry.channel_id)
        envelope = refreshed
        tokenExpiresAt = refreshed.expiresAt ?? null
      }
    }
    accessToken = envelope?.accessToken
  }

  const snap = (version?.snapshot ?? {}) as {
    title?: string
    body?: string
    link?: string
    media?: { url?: string; asset_id?: string }[]
  }
  // Resolve each media item: an external URL as-is, or a library asset_id → a FRESH
  // signed URL minted now (stored signed URLs expire, so never trust a snapshot URL).
  const mediaItems = Array.isArray(snap.media) ? snap.media : []
  const mediaUrls = (
    await Promise.all(
      mediaItems.map(async (m) => {
        if (m.url) return m.url
        if (m.asset_id) {
          const { data } = await db.from('social_media_assets').select('storage_ref').eq('id', m.asset_id).is('deleted_at', null).maybeSingle()
          const ref = (data as { storage_ref?: string } | null)?.storage_ref
          return ref ? await signMediaUrl(ref) : null
        }
        return null
      }),
    )
  ).filter((u): u is string => !!u)
  const input: PublishInput = {
    title: snap.title,
    body: snap.body ?? '',
    mediaUrls,
    link: snap.link,
  }
  const ctx: ChannelContext = {
    platform,
    externalAccountId: channel?.external_account_id ?? null,
    hasCredential: !!channel?.has_credential,
    tokenExpiresAt,
    accessToken,
  }

  const pub = await getAdapter(platform).publish(input, ctx)
  const attemptNo = entry.attempts + 1

  // Append the immutable attempt record.
  await db.from('social_publish_log').insert({
    schedule_entry_id: entry.id,
    version_id: entry.version_id,
    channel_id: entry.channel_id,
    attempt: attemptNo,
    outcome: pub.ok ? 'success' : 'failure',
    platform_post_id: pub.ok ? pub.platformPostId : null,
    platform_response: pub.ok ? { id: pub.platformPostId } : { code: pub.error.code },
    failure_reason: pub.ok ? null : pub.error.message,
    published_at: pub.ok ? new Date(nowMs).toISOString() : null,
  })

  const decision = planAfterAttempt(
    pub.ok ? { ok: true } : { ok: false, error: { code: pub.error.code, retryable: pub.error.retryable } },
    entry.attempts,
    nowMs,
  )

  await db
    .from('social_schedule_entries')
    .update({
      status: decision.nextStatus as SocialScheduleStatus,
      attempts: entry.attempts + decision.attemptsInc,
      next_attempt_at: decision.nextAttemptAtMs ? new Date(decision.nextAttemptAtMs).toISOString() : null,
      last_error: pub.ok ? null : pub.error.message,
      updated_by: 'system:social-publish',
    })
    .eq('id', entry.id)

  if (decision.kind === 'published') {
    result.published++
    // Advance the frozen version and its content item to PUBLISHED (status only —
    // the immutability trigger permits a lifecycle transition).
    await db.from('social_content_versions').update({ status: 'PUBLISHED' }).eq('id', entry.version_id)
    if (version?.content_id) {
      await db.from('social_content').update({ status: 'PUBLISHED', updated_by: 'system:social-publish' }).eq('id', version.content_id)
    }
  } else if (decision.kind === 'dead_letter') {
    result.deadLettered++
  } else {
    result.retriedOrHeld++
  }
}
