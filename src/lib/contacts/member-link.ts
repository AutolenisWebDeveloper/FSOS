// The household book ↔ Contact Record bridge — pure half.
//
// WHY THIS EXISTS. The Contacts workspace resolves to the book (`/app/households`) —
// `/app/contacts` redirects there and the sidebar's "All Contacts" points at it — so
// every click from Contacts lands on a household or a member, and the Contact Record at
// `/app/contacts/[id]` had no inbound link from either. It was reachable only from
// Win-Back, the calendar, social attribution, and the create form.
//
// THE KEY. `household_members.source_contact_id` is the canonical link: a real FK to
// contacts(id), UNIQUE where set (migration 071), and backfilled for the in-force book
// import by migration 091. No name/email/phone heuristic is needed or wanted — 091
// deliberately left ambiguous matches unlinked, and guessing here would reintroduce
// exactly the misattribution it avoided.
//
// TWO REASONS A LINK IS ABSENT, both normal and both rendered the same way (no link):
//   • the member was created directly in the book (`/members/new`), so it never had a
//     contact behind it;
//   • the contact was soft-deleted. The FK is ON DELETE SET NULL, so a PURGE clears the
//     column, but a SOFT delete leaves `source_contact_id` pointing at a row that
//     `/app/contacts/[id]` refuses to render (record-data filters `deleted_at`). A link
//     is therefore only offered once the contact is confirmed live — otherwise the book
//     would advertise a 404.
//
// Import-free on purpose (same split as record-view / record-data): the mapping is a
// pure function of rows the caller already has, so it is provable without a database.
// The read that decides which contacts are live lives in `member-link-data.ts`.

/** A household member, as far as the contact link is concerned. */
export interface LinkableMember {
  id: string
  source_contact_id?: string | null
}

/** member id → contact id, for members with a live contact record. */
export type MemberContactLinks = ReadonlyMap<string, string>

/**
 * How many contact ids one lookup will probe. A household is a family, not a list, so
 * this is far above any real household; it exists so a corrupt or bulk-imported
 * household can never turn one page render into an unbounded `IN (...)`.
 */
export const MAX_LINK_LOOKUP = 200

/** The Contact Record URL for a contact id. One definition, so the route moves once. */
export function contactRecordHref(contactId: string): string {
  return `/app/contacts/${contactId}`
}

/** The distinct contact ids a member set points at, in first-seen order, capped. */
export function linkedContactIds(members: readonly LinkableMember[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of members) {
    const id = m.source_contact_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_LINK_LOOKUP) break
  }
  return out
}

/**
 * Pair members with their contact, keeping only the ones whose contact is in `live`.
 * Pure — the caller supplies the set of contact ids that actually resolve, so the
 * mapping is testable without a database.
 */
export function memberContactLinks(
  members: readonly LinkableMember[],
  live: Iterable<string>,
): MemberContactLinks {
  const liveSet = live instanceof Set ? live : new Set(live)
  const links = new Map<string, string>()
  for (const m of members) {
    const id = m.source_contact_id
    if (id && liveSet.has(id)) links.set(m.id, id)
  }
  return links
}
