import { ListShell, ListSkeleton } from '@/components/archetypes'

export default function Loading() {
  return (
    <ListShell title="Agency Partnerships" description="Loading your book…">
      <ListSkeleton rows={8} />
    </ListShell>
  )
}
