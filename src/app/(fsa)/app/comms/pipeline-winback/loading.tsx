import { ListShell, ListSkeleton } from '@/components/archetypes'

// Content-matched loading state for the Pipeline Win-Back operations dashboard (§13.1/§21 —
// a skeleton that mirrors the page shell, never a bare spinner). This route used to render the
// campaign DETAIL skeleton because the route itself was a detail page; now that Win-Back has a
// list → [id] split, the list skeleton belongs here and the detail skeleton lives at [id].
export default function Loading() {
  return (
    <ListShell title="Pipeline Win-Back" description="Loading campaign operations…">
      <ListSkeleton rows={8} label="Loading the Pipeline Win-Back campaign…" />
    </ListShell>
  )
}
