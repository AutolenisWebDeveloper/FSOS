import { ListShell, CardsSkeleton, ListSkeleton } from '@/components/archetypes'

// Hub-level loading fallback for the AI Communications Center (§21 — skeleton, never a
// bare spinner). Next.js renders this inside the comms layout (the sub-navigation stays
// visible) for the Overview and any child route that does not supply its own loading UI.
export default function Loading() {
  return (
    <ListShell title="AI Communications Center" description="Loading your communications workspace…">
      <div className="space-y-6">
        <CardsSkeleton count={4} />
        <ListSkeleton rows={6} />
      </div>
    </ListShell>
  )
}
