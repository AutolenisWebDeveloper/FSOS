'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Pin,
  Pencil,
  Trash2,
  StickyNote,
  Plus,
  Circle,
  Phone,
  MessageSquare,
  Mail,
  CalendarCheck,
  ClipboardList,
  Target,
  GitBranch,
  FileUp,
  FileText,
  Bot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ModalShell } from '@/components/archetypes/overlays'
import { EmptyState } from '@/components/archetypes/states'
import { postJson, patchJson, deleteJson, firstFieldError } from '@/lib/client/api'
import { timeAgo, humanize } from '@/lib/dashboards/format'

/*
 * Contact 360 Notes UI (redesign follow-up) — the shared design-system pieces (§12).
 * A note is internal FSA free text, NOT a communication (no dispatcher path). These
 * extend ContactTimeline; no page hand-rolls its own notes widget.
 */

export interface NoteRecord {
  id: string
  member_id: string | null
  author_id: string
  body: string
  is_pinned: boolean
  created_at: string
  updated_at: string
}

export interface ActivityRecord {
  id: string
  kind: string | null
  note: string | null
  actor: string | null
  created_at: string
}

const KIND_ICON: Record<string, typeof Circle> = {
  note: StickyNote,
  call: Phone,
  sms: MessageSquare,
  email: Mail,
  appointment: CalendarCheck,
  review: ClipboardList,
  opportunity: Target,
  stage: GitBranch,
  stage_change: GitBranch,
  import: FileUp,
  document: FileText,
  ai: Bot,
  agent: Bot,
}

// ─── Composer ──────────────────────────────────────────────────────────────────

export function NoteComposer({
  householdId,
  memberId,
  onDone,
  autoFocus,
}: {
  householdId: string
  memberId?: string | null
  onDone?: () => void
  autoFocus?: boolean
}) {
  const router = useRouter()
  const [body, setBody] = React.useState('')
  const [pinned, setPinned] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  async function save() {
    const text = body.trim()
    if (!text) {
      toast.error('Write a note first')
      return
    }
    setSaving(true)
    const res = await postJson(`/api/households/${householdId}/notes`, {
      body: text,
      member_id: memberId ?? null,
      is_pinned: pinned,
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Note added')
    setBody('')
    setPinned(false)
    router.refresh()
    onDone?.()
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note…"
        rows={3}
        aria-label="Note body"
        autoFocus={autoFocus}
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin as important
        </label>
        <Button size="sm" onClick={save} loading={saving} disabled={saving}>
          Add note
        </Button>
      </div>
    </div>
  )
}

/** ActionBar entry (§4.2): "Add Note" opens the shared composer in a modal. */
export function AddNoteButton({ householdId, memberId }: { householdId: string; memberId?: string | null }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <StickyNote className="h-4 w-4" /> Add note
      </Button>
      <ModalShell open={open} onOpenChange={setOpen} title="Add note">
        <NoteComposer householdId={householdId} memberId={memberId} autoFocus onDone={() => setOpen(false)} />
      </ModalShell>
    </>
  )
}

// ─── Note item (pin / edit / delete) ────────────────────────────────────────────

export function NoteItem({ note }: { note: NoteRecord }) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(note.body)
  const [busy, setBusy] = React.useState(false)

  async function mutate(fn: () => Promise<{ ok: boolean; error?: unknown }>, okMsg: string) {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (!res.ok) {
      toast.error('Could not update the note')
      return false
    }
    toast.success(okMsg)
    router.refresh()
    return true
  }

  async function togglePin() {
    await mutate(() => patchJson(`/api/notes/${note.id}`, { is_pinned: !note.is_pinned }), note.is_pinned ? 'Unpinned' : 'Pinned')
  }
  async function saveEdit() {
    const text = draft.trim()
    if (!text) {
      toast.error('Note cannot be empty')
      return
    }
    if (await mutate(() => patchJson(`/api/notes/${note.id}`, { body: text }), 'Note updated')) setEditing(false)
  }
  async function remove() {
    await mutate(() => deleteJson(`/api/notes/${note.id}`), 'Note deleted')
  }

  return (
    <li className="relative">
      <span className="absolute -left-[1.4rem] flex h-6 w-6 items-center justify-center rounded-full border bg-background text-primary" aria-hidden>
        <StickyNote className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <div className="rounded-lg border bg-primary-soft/10 p-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            Note {note.is_pinned ? <Pin className="h-3.5 w-3.5 text-primary" aria-label="Pinned" /> : null}
          </p>
          <time dateTime={note.created_at} className="shrink-0 text-xs tabular-nums text-muted-foreground" title={new Date(note.created_at).toLocaleString()}>
            {timeAgo(note.created_at)}
          </time>
        </div>
        {editing ? (
          <div className="mt-1.5 space-y-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label="Edit note" autoFocus />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} loading={busy} disabled={busy}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(note.body) }} disabled={busy}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{note.body}</p>
            <div className="mt-1.5 flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={togglePin} disabled={busy}>
                <Pin className="h-3.5 w-3.5" /> {note.is_pinned ? 'Unpin' : 'Pin'}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(true)} disabled={busy}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={remove} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </>
        )}
      </div>
    </li>
  )
}

function ActivityItem({ activity }: { activity: ActivityRecord }) {
  const Icon = (activity.kind && KIND_ICON[activity.kind]) || Circle
  return (
    <li className="relative">
      <span className="absolute -left-[1.4rem] flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground" aria-hidden>
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{humanize(activity.kind) || 'Activity'}</p>
        <time dateTime={activity.created_at} className="shrink-0 text-xs tabular-nums text-muted-foreground" title={new Date(activity.created_at).toLocaleString()}>
          {timeAgo(activity.created_at)}
        </time>
      </div>
      {activity.note ? <p className="mt-0.5 text-sm text-muted-foreground">{activity.note}</p> : null}
      {activity.actor ? <p className="mt-0.5 text-xs text-muted-foreground">by {activity.actor}</p> : null}
    </li>
  )
}

// ─── The tabbed timeline panel ───────────────────────────────────────────────────

type Tab = 'all' | 'notes'

export function ContactTimelinePanel({
  householdId,
  memberId,
  activities,
  notes,
  heading = 'Timeline',
}: {
  householdId: string
  memberId?: string | null
  activities: ActivityRecord[]
  notes: NoteRecord[]
  heading?: string
}) {
  const [tab, setTab] = React.useState<Tab>('all')
  const [composing, setComposing] = React.useState(false)

  const pinned = notes.filter((n) => n.is_pinned)
  const unpinnedNotes = notes.filter((n) => !n.is_pinned)

  // "All" merges unpinned notes + system activities chronologically; pinned notes
  // float to the top. "Notes" is notes-only (no system-event noise).
  const merged = React.useMemo(() => {
    const items = [
      ...unpinnedNotes.map((n) => ({ t: 'note' as const, at: n.created_at, n })),
      ...activities.map((a) => ({ t: 'activity' as const, at: a.created_at, a })),
    ]
    items.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
    return items
  }, [unpinnedNotes, activities])

  const isEmpty = tab === 'all' ? notes.length === 0 && activities.length === 0 : notes.length === 0

  return (
    <section aria-label={heading} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setComposing((v) => !v)} aria-expanded={composing}>
          <Plus className="h-3.5 w-3.5" /> Add note
        </Button>
      </div>

      <div className="inline-flex rounded-md border p-0.5 text-xs" role="tablist" aria-label="Timeline filter">
        {(['all', 'notes'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={'rounded px-2.5 py-1 capitalize ' + (tab === k ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            {k === 'all' ? 'All' : 'Notes'}
          </button>
        ))}
      </div>

      {composing ? (
        <div className="rounded-lg border p-2.5">
          <NoteComposer householdId={householdId} memberId={memberId} autoFocus onDone={() => setComposing(false)} />
        </div>
      ) : null}

      {pinned.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pinned</p>
          <ol className="relative space-y-3 border-l pl-4">
            {pinned.map((n) => <NoteItem key={n.id} note={n} />)}
          </ol>
        </div>
      ) : null}

      {isEmpty ? (
        <EmptyState
          title={tab === 'notes' ? 'No notes yet' : 'Nothing logged yet'}
          description={tab === 'notes' ? 'Add one to capture context for this contact.' : 'Notes, calls, emails, appointments, reviews, and imports appear here.'}
        />
      ) : tab === 'notes' ? (
        <ol className="relative space-y-3 border-l pl-4">
          {unpinnedNotes.map((n) => <NoteItem key={n.id} note={n} />)}
        </ol>
      ) : (
        <ol className="relative space-y-3 border-l pl-4">
          {merged.map((item) =>
            item.t === 'note' ? <NoteItem key={`n-${item.n.id}`} note={item.n} /> : <ActivityItem key={`a-${item.a.id}`} activity={item.a} />,
          )}
        </ol>
      )}
    </section>
  )
}
