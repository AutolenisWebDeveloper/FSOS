import { load } from '@/lib/data/query'
import { ErrorState } from '@/components/archetypes'
import { ContactTimelinePanel, type ActivityRecord, type NoteRecord } from './notes'

/*
 * Contact 360 Timeline (redesign spec §9) — the chronological spine of the record.
 * A single stream that MERGES the append-only `activities` event stream with the
 * editable `notes` table (redesign follow-up): notes surface inline as `note`
 * entries, pinned notes float to the top, and a Notes-only filter hides system
 * events. Server component (RLS-scoped read) that fetches both and delegates to the
 * client ContactTimelinePanel for the tabs, composer, and per-note pin/edit/delete.
 *
 * Reusable member-scoped variant: pass householdId + memberId (and the member
 * activity entity) to render just that person's notes and activity (§4.3).
 */
export async function ContactTimeline({
  householdId,
  memberId,
  entityType = 'household',
  entityId,
  limit = 40,
  heading = 'Timeline',
}: {
  /** Household the notes belong to (notes are keyed by household + optional member). */
  householdId: string
  /** When set, scopes notes (and the heading) to a single member. */
  memberId?: string
  /** Activity-stream entity (defaults to the household). */
  entityType?: string
  entityId?: string
  limit?: number
  heading?: string
}) {
  const activityId = entityId ?? householdId

  const [activitiesRes, notesRes] = await Promise.all([
    load<ActivityRecord[]>(
      (db) =>
        db
          .from('activities')
          .select('id, kind, note, actor, created_at')
          .eq('entity_type', entityType)
          .eq('entity_id', activityId)
          .order('created_at', { ascending: false })
          .limit(limit),
      [],
    ),
    load<NoteRecord[]>(
      (db) => {
        let q = db
          .from('notes')
          .select('id, member_id, author_id, body, is_pinned, created_at, updated_at')
          .eq('household_id', householdId)
          .is('deleted_at', null)
        if (memberId) q = q.eq('member_id', memberId)
        return q.order('created_at', { ascending: false })
      },
      [],
    ),
  ])

  // The activity stream failing is a hard error; notes degrade to empty.
  if (!activitiesRes.ok) return <ErrorState description="Could not load the timeline." />

  return (
    <ContactTimelinePanel
      householdId={householdId}
      memberId={memberId ?? null}
      activities={activitiesRes.ok ? activitiesRes.data : []}
      notes={notesRes.ok ? notesRes.data : []}
      heading={heading}
    />
  )
}
