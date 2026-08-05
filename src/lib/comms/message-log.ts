import { load, type LoadResult } from '@/lib/data/query'
import type { MessageLogRow } from '@/components/comms/MessageLogTable'

/*
 * One query shape for every message-log view. The channel pages previously each
 * declared their own inline row type and select string; they drifted (the SMS and
 * email pages never selected `consent_at_send`, so their Gate column could not have
 * rendered a consent result even after the badge was fixed).
 */

const SELECT = 'id, channel, direction, recipient, body, delivery_status, blocked_step, block_reason, consent_at_send, created_at'

export function loadMessageLog(opts: {
  channel?: 'sms' | 'email'
  /** Restrict to exception rows — the Delivery queue view. */
  statuses?: string[]
  limit?: number
}): Promise<LoadResult<MessageLogRow[]>> {
  const { channel, statuses, limit = 200 } = opts
  return load<MessageLogRow[]>((db) => {
    let q = db.from('comm_messages').select(SELECT)
    if (channel) q = q.eq('channel', channel)
    if (statuses?.length) q = q.in('delivery_status', statuses)
    return q.order('created_at', { ascending: false }).limit(limit)
  }, [])
}
