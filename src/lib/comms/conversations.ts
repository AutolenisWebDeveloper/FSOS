// src/lib/comms/conversations.ts
// Conversation threading + automatic contact association. Every inbound and
// outbound message is attached to ONE conversation per (channel, contact), and
// each conversation is resolved to member → household → agency (+ policy where
// known) so the whole history lives on the correct records. There is exactly one
// thread per contact per channel (unique in the schema), so replies and campaign
// sends land in the same timeline as the contact's other messages.

import { getDb } from '@/lib/supabase/client'

export type Channel = 'sms' | 'email'
export type Direction = 'inbound' | 'outbound'

export interface ContactLink {
  memberId: string | null
  householdId: string | null
  agencyId: string | null
}

/** Normalize a contact address so the same person always maps to one thread. */
export function normalizeContact(channel: Channel, raw: string): string {
  const v = (raw || '').trim()
  if (channel === 'email') return v.toLowerCase()
  // SMS: keep a leading +, strip all other non-digits → best-effort E.164.
  const plus = v.startsWith('+') ? '+' : ''
  return plus + v.replace(/[^\d]/g, '')
}

/** Last 10 digits — used for tolerant phone matching against stored numbers. */
function last10(phone: string): string {
  return phone.replace(/[^\d]/g, '').slice(-10)
}

/**
 * Resolve a channel address to a member/household/agency. Matches a
 * household_member by email (exact, case-insensitive) or phone (last-10), then
 * derives the household's referring agency. Returns all-null when unknown (the
 * message still threads under the raw contact and is surfaced for triage).
 */
export async function resolveContact(channel: Channel, contact: string): Promise<ContactLink> {
  const db = getDb()
  const empty: ContactLink = { memberId: null, householdId: null, agencyId: null }
  try {
    let memberId: string | null = null
    let householdId: string | null = null

    if (channel === 'email') {
      const { data } = await db
        .from('household_members')
        .select('id, household_id')
        .ilike('email', contact)
        .limit(1)
        .maybeSingle()
      if (data) {
        memberId = data.id
        householdId = data.household_id
      }
    } else {
      const tail = last10(contact)
      if (tail.length >= 7) {
        const { data } = await db
          .from('household_members')
          .select('id, household_id, phone')
          .ilike('phone', `%${tail}%`)
          .limit(5)
        const hit = (data ?? []).find((r: { phone: string | null }) => last10(r.phone ?? '') === tail)
        if (hit) {
          memberId = hit.id
          householdId = hit.household_id
        }
      }
    }

    let agencyId: string | null = null
    if (householdId) {
      const { data: hh } = await db
        .from('households')
        .select('referring_agency_id')
        .eq('id', householdId)
        .maybeSingle()
      agencyId = hh?.referring_agency_id ?? null
    }

    return { memberId, householdId, agencyId }
  } catch {
    return empty
  }
}

/** Whether the resolved household/policy carries the securities firewall flag. */
export async function conversationIsSecurity(householdId: string | null): Promise<boolean> {
  if (!householdId) return false
  try {
    const db = getDb()
    const { data } = await db
      .from('household_policies')
      .select('id')
      .eq('household_id', householdId)
      .eq('is_security', true)
      .is('deleted_at', null)
      .limit(1)
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

export interface Conversation {
  id: string
  channel: Channel
  contact: string
  member_id: string | null
  household_id: string | null
  agency_id: string | null
  is_security: boolean
  ai_autoreply: boolean
  status: string
}

/**
 * Find-or-create the single thread for (channel, contact) and (re)associate it to
 * the resolved member/household/agency. Idempotent on the unique (channel, contact).
 */
export async function getOrCreateConversation(channel: Channel, rawContact: string): Promise<Conversation | null> {
  const db = getDb()
  const contact = normalizeContact(channel, rawContact)
  if (!contact) return null

  const { data: existing } = await db
    .from('comm_conversations')
    .select('id, channel, contact, member_id, household_id, agency_id, is_security, ai_autoreply, status')
    .eq('channel', channel)
    .eq('contact', contact)
    .maybeSingle()

  const link = await resolveContact(channel, contact)
  const isSecurity = await conversationIsSecurity(link.householdId)

  if (existing) {
    // Backfill association if the contact has since been matched to a member.
    const patch: Record<string, unknown> = {}
    if (!existing.member_id && link.memberId) patch.member_id = link.memberId
    if (!existing.household_id && link.householdId) patch.household_id = link.householdId
    if (!existing.agency_id && link.agencyId) patch.agency_id = link.agencyId
    if (isSecurity && !existing.is_security) patch.is_security = true
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString()
      await db.from('comm_conversations').update(patch).eq('id', existing.id)
      return { ...existing, ...patch } as Conversation
    }
    return existing as Conversation
  }

  const { data: created } = await db
    .from('comm_conversations')
    .insert({
      channel,
      contact,
      member_id: link.memberId,
      household_id: link.householdId,
      agency_id: link.agencyId,
      is_security: isSecurity,
      status: 'open',
    })
    .select('id, channel, contact, member_id, household_id, agency_id, is_security, ai_autoreply, status')
    .maybeSingle()

  // Lost a race on the unique index → re-read the winning row.
  if (!created) {
    const { data: raced } = await db
      .from('comm_conversations')
      .select('id, channel, contact, member_id, household_id, agency_id, is_security, ai_autoreply, status')
      .eq('channel', channel)
      .eq('contact', contact)
      .maybeSingle()
    return (raced as Conversation) ?? null
  }
  return created as Conversation
}

/** Update the thread's recency + unread pointer after a message lands. */
export async function touchConversation(
  conversationId: string,
  direction: Direction,
  opts: { incrementUnread?: boolean } = {},
): Promise<void> {
  const db = getDb()
  const patch: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
    last_direction: direction,
    updated_at: new Date().toISOString(),
  }
  if (direction === 'inbound' && opts.incrementUnread) {
    const { data } = await db.from('comm_conversations').select('unread_count').eq('id', conversationId).maybeSingle()
    patch.unread_count = (data?.unread_count ?? 0) + 1
    patch.status = 'open'
  }
  if (direction === 'outbound') patch.unread_count = 0
  await db.from('comm_conversations').update(patch).eq('id', conversationId)
}
