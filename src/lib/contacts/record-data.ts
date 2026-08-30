// src/lib/contacts/record-data.ts
// Server reads for the Contact Record workspace (/app/contacts/[id]).
//
// One loader, one round of parallel queries. The record is a CONTACT-rooted view
// that also folds in the linked household's aggregate (policies, people, reviews,
// notes, documents) — exactly the join the flat page already made for policies,
// widened to the rest of the spine. Nothing here is a new business rule: every
// read is an existing table filtered by contact_id / household_id, and every
// query is bounded (`.limit`) so a long-lived record can never fan out.
//
// Reads only. All mutations stay on the existing RBAC-gated API routes.

import { load } from '@/lib/data/query'
import { phoneTail } from './record-view'
import type { AppointmentRow, OpportunityRow, PolicyRow, StreamRow, TaskRow } from './record-view'

export interface ContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  email: string | null
  phone: string | null
  company: string | null
  title: string | null
  contact_type: string
  tags: string[]
  source: string | null
  status: string
  household_id: string | null
  agency_partnership_id: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
  dob: string | null
  lines_of_business: string[] | null
  owner_scope: string | null
  created_by: string | null
  created_at: string
  updated_at: string | null
}

export interface MemberRow {
  id: string
  full_name: string
  relationship: string | null
  email: string | null
  phone: string | null
}

export interface ReviewRow {
  id: string
  type: string
  stage: string
  scheduled_at: string | null
}

export interface NoteRow {
  id: string
  member_id: string | null
  author_id: string
  body: string
  is_pinned: boolean
  created_at: string
  updated_at: string
}

export interface DocumentRow {
  id: string
  classification: string | null
  version: number
  created_at: string
}

export interface DocumentRequestRow {
  id: string
  requirement: string
  status: string
  created_at: string
}

export interface MessageRow {
  id: string
  channel: string
  direction: string
  recipient: string | null
  body: string | null
  delivery_status: string
  created_at: string
}

export interface ConsentRow {
  channel: string
  status: string
  captured_at: string
  /** Member the grant belongs to; null for a contact-resolvable (mig 074) row. */
  member_id: string | null
}

export interface ContactRecord {
  contact: ContactRow
  household: { id: string; primary_name: string; city: string | null; state: string | null; do_not_contact: boolean } | null
  agencyName: string | null
  members: MemberRow[]
  policies: PolicyRow[]
  opportunities: OpportunityRow[]
  appointments: AppointmentRow[]
  reviews: ReviewRow[]
  tasks: TaskRow[]
  activities: StreamRow[]
  notes: NoteRow[]
  documents: DocumentRow[]
  documentRequests: DocumentRequestRow[]
  messages: MessageRow[]
  /** Household-member consent rows (mig 009) merged with contact-resolvable ones (mig 074). */
  consents: ConsentRow[]
  suppressed: { sms: boolean; email: boolean; call: boolean }
}

const EMPTY = <T,>(): Promise<{ ok: true; data: T[] }> => Promise.resolve({ ok: true as const, data: [] as T[] })

/** `contact_id.eq.X,household_id.eq.Y` — the OR the contact-rooted reads need. */
function scopeOr(contactId: string, householdId: string | null): string {
  return householdId ? `contact_id.eq.${contactId},household_id.eq.${householdId}` : `contact_id.eq.${contactId}`
}

export async function loadContactRecord(contactId: string): Promise<
  { ok: false; kind: 'not_configured' | 'error'; message: string } | { ok: true; data: ContactRecord | null }
> {
  const res = await load<ContactRow | null>(
    (db) => db.from('contacts').select('*').eq('id', contactId).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return res
  const contact = res.data
  if (!contact) return { ok: true, data: null }

  const hh = contact.household_id
  const entityIds = hh ? [contactId, hh] : [contactId]
  const emailLc = (contact.email ?? '').trim().toLowerCase()
  const tail = phoneTail(contact.phone)

  // PostgREST `or=` is comma/paren delimited, so an address containing either
  // would corrupt the expression — such a value is simply left out of the filter
  // (its consent rows then read as "no consent recorded", the safe direction).
  const reachabilityTerms = [
    emailLc && !/[(),]/.test(emailLc) ? `contact.eq.${emailLc}` : null,
    tail.length === 10 ? `contact.ilike.*${tail}` : null,
  ].filter(Boolean)
  const reachabilityFilter = reachabilityTerms.length > 0 ? reachabilityTerms.join(',') : null

  const [
    householdR,
    agencyR,
    membersR,
    policiesR,
    oppsR,
    apptsR,
    reviewsR,
    tasksR,
    activitiesR,
    notesR,
    docsR,
    docReqR,
    messagesR,
    memberConsentR,
    contactConsentR,
    dncR,
  ] = await Promise.all([
    hh
      ? load<{ id: string; primary_name: string; city: string | null; state: string | null; do_not_contact: boolean } | null>(
          (db) => db.from('households').select('id, primary_name, city, state, do_not_contact').eq('id', hh).is('deleted_at', null).maybeSingle(),
          null,
        )
      : Promise.resolve({ ok: true as const, data: null }),
    contact.agency_partnership_id
      ? load<{ agency_name: string } | null>(
          (db) => db.from('agency_partnerships').select('agency_name').eq('id', contact.agency_partnership_id!).maybeSingle(),
          null,
        )
      : Promise.resolve({ ok: true as const, data: null }),
    hh
      ? load<MemberRow[]>(
          (db) => db.from('household_members').select('id, full_name, relationship, email, phone').eq('household_id', hh).is('deleted_at', null).order('created_at').limit(25),
          [],
        )
      : EMPTY<MemberRow>(),
    load<PolicyRow[]>(
      (db) =>
        db
          .from('household_policies')
          .select('id, policy_number, product_name, status, is_security, face_amount')
          .or(scopeOr(contactId, hh))
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(50),
      [],
    ),
    load<OpportunityRow[]>(
      (db) =>
        db
          .from('opportunities')
          .select('id, stage, engagement, is_security, expected_commission, face_amount, updated_at')
          .or(scopeOr(contactId, hh))
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(50),
      [],
    ),
    load<AppointmentRow[]>(
      (db) =>
        db
          .from('appointments')
          .select('id, scheduled_at, status')
          .or(scopeOr(contactId, hh))
          .order('scheduled_at', { ascending: false })
          .limit(25),
      [],
    ),
    hh
      ? load<ReviewRow[]>(
          (db) => db.from('reviews').select('id, type, stage, scheduled_at').eq('household_id', hh).is('deleted_at', null).order('created_at', { ascending: false }).limit(25),
          [],
        )
      : EMPTY<ReviewRow>(),
    load<TaskRow[]>(
      (db) =>
        db
          .from('work_tasks')
          .select('id, title, due_at, completed, source, entity_type')
          .in('entity_id', entityIds)
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(50),
      [],
    ),
    // entity_id alone is sufficient on the polymorphic streams: a UUID identifies
    // exactly one row in one table, so filtering by the contact's and household's
    // ids cannot pull in another entity's events, and it avoids a two-column OR.
    load<StreamRow[]>(
      (db) =>
        db
          .from('activities')
          .select('id, kind, note, actor, created_at')
          .in('entity_id', entityIds)
          .order('created_at', { ascending: false })
          .limit(60),
      [],
    ),
    hh
      ? load<NoteRow[]>(
          (db) => db.from('notes').select('id, member_id, author_id, body, is_pinned, created_at, updated_at').eq('household_id', hh).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
          [],
        )
      : EMPTY<NoteRow>(),
    load<DocumentRow[]>(
      (db) => db.from('documents').select('id, classification, version, created_at').in('entity_id', entityIds).order('created_at', { ascending: false }).limit(25),
      [],
    ),
    hh
      ? load<DocumentRequestRow[]>(
          (db) => db.from('document_requests').select('id, requirement, status, created_at').eq('household_id', hh).order('created_at', { ascending: false }).limit(25),
          [],
        )
      : EMPTY<DocumentRequestRow>(),
    load<MessageRow[]>(
      (db) => db.from('comm_messages').select('id, channel, direction, recipient, body, delivery_status, created_at').in('entity_id', entityIds).order('created_at', { ascending: false }).limit(25),
      [],
    ),
    hh
      ? load<ConsentRow[]>(
          (db) => db.from('consents').select('member_id, channel, status, captured_at').eq('household_id', hh).order('captured_at', { ascending: false }).limit(25),
          [],
        )
      : EMPTY<ConsentRow>(),
    // Contact-resolvable consent (mig 074): one row per ACTION, latest wins. Scoped
    // to THIS contact's address/number in the query so the record never scans the
    // whole store, using the same tolerant match the send path uses.
    reachabilityFilter
      ? load<{ contact: string; channel: string; action: string; captured_at: string }[]>(
          (db) =>
            db
              .from('comm_contact_consents')
              .select('contact, channel, action, captured_at')
              .or(reachabilityFilter)
              .order('captured_at', { ascending: false })
              .limit(50),
          [],
        )
      : EMPTY<{ contact: string; channel: string; action: string; captured_at: string }>(),
    reachabilityFilter
      ? load<{ contact: string; channel: string }[]>(
          (db) => db.from('dnc_entries').select('contact, channel').or(reachabilityFilter).limit(50),
          [],
        )
      : EMPTY<{ contact: string; channel: string }>(),
  ])

  const ok = <T,>(r: { ok: boolean; data?: T }, fallback: T): T => (r.ok && r.data !== undefined ? (r.data as T) : fallback)

  const members = ok(membersR, [] as MemberRow[])
  // Which household member IS this contact? Matched on the same normalized
  // email / last-10 phone the dedupe and send paths use.
  const selfMemberId =
    members.find(
      (m) =>
        (!!emailLc && (m.email ?? '').trim().toLowerCase() === emailLc) ||
        (tail.length === 10 && phoneTail(m.phone) === tail),
    )?.id ?? null

  // Contact-resolvable consent, narrowed to THIS contact's address/number with the
  // same tolerant matching the send path uses (email lower-cased, phone last-10).
  const contactConsents = ok(
    contactConsentR,
    [] as { contact: string; channel: string; action: string; captured_at: string }[],
  ).filter((r) => {
    const key = String(r.contact ?? '')
    return (r.channel ?? '').toLowerCase() === 'email'
      ? !!emailLc && key.toLowerCase() === emailLc
      : !!tail && phoneTail(key) === tail
  })

  const dnc = ok(dncR, [] as { contact: string; channel: string }[]).filter((d) => {
    const c = String(d.contact ?? '')
    return (!!emailLc && c.toLowerCase() === emailLc) || (!!tail && phoneTail(c) === tail)
  })
  const suppressedFor = (channel: 'sms' | 'email' | 'call') =>
    dnc.some((d) => d.channel === 'all' || d.channel === channel)

  return {
    ok: true,
    data: {
      contact,
      household: ok(householdR, null),
      agencyName: ok(agencyR, null as { agency_name: string } | null)?.agency_name ?? null,
      members,
      policies: ok(policiesR, [] as PolicyRow[]),
      opportunities: ok(oppsR, [] as OpportunityRow[]),
      appointments: ok(apptsR, [] as AppointmentRow[]),
      reviews: ok(reviewsR, [] as ReviewRow[]),
      tasks: ok(tasksR, [] as TaskRow[]),
      activities: ok(activitiesR, [] as StreamRow[]),
      notes: ok(notesR, [] as NoteRow[]),
      documents: ok(docsR, [] as DocumentRow[]),
      documentRequests: ok(docReqR, [] as DocumentRequestRow[]),
      messages: ok(messagesR, [] as MessageRow[]),
      // Household consent is keyed by MEMBER. Only the member who IS this contact
      // may speak for them — a spouse's grant must never render as this person's —
      // so the household rows are narrowed to the matching member (identified by
      // the same email/phone) and dropped entirely when no member matches.
      consents: [
        ...(selfMemberId ? ok(memberConsentR, [] as ConsentRow[]).filter((c) => c.member_id === selfMemberId) : []),
        ...contactConsents.map((c) => ({
          member_id: null,
          channel: c.channel,
          status: c.action === 'granted' ? 'granted' : 'revoked',
          captured_at: c.captured_at,
        })),
      ],
      suppressed: { sms: suppressedFor('sms'), email: suppressedFor('email'), call: suppressedFor('call') },
    },
  }
}
