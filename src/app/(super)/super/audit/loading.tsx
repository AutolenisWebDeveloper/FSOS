import { ListShell, ListSkeleton } from '@/components/archetypes'

export default function Loading() {
  return (
    <ListShell title="Audit Log" description="Loading…">
      <ListSkeleton rows={10} />
    </ListShell>
  )
}
