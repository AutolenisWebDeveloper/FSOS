import { ListShell, ListSkeleton } from '@/components/archetypes'

export default function Loading() {
  return (
    <ListShell title="AI Escalations" description="Loading…">
      <ListSkeleton rows={8} />
    </ListShell>
  )
}
