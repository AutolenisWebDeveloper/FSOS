// The household book ↔ Contact Record bridge — read half. The mapping rules and the
// reasoning behind them live in `member-link.ts`; this file only decides which of the
// linked contacts actually resolve.
import { load } from '@/lib/data/query'
import { linkedContactIds, memberContactLinks, type LinkableMember, type MemberContactLinks } from './member-link'

/**
 * Resolve which of these members have a LIVE contact record behind them — one bounded
 * read, or none at all when no member carries a link.
 *
 * Degrades to "no links" if the lookup fails: a cross-link is navigational sugar, and a
 * transient read error must not take down the member list it sits in. The absence is
 * visible (the affordance simply isn't offered), never a broken link.
 */
export async function loadMemberContactLinks(
  members: readonly LinkableMember[],
): Promise<MemberContactLinks> {
  const ids = linkedContactIds(members)
  if (ids.length === 0) return new Map()
  const res = await load<{ id: string }[]>(
    (db) => db.from('contacts').select('id').in('id', ids).is('deleted_at', null),
    [],
  )
  if (!res.ok) return new Map()
  return memberContactLinks(members, res.data.map((r) => r.id))
}
