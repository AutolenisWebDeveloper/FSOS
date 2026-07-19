import { ListShell, ListSkeleton } from '@/components/archetypes'

export default function Loading() {
  return (
    <ListShell title="Firewall & Comms Blocks" description="Loading…">
      <ListSkeleton rows={8} />
    </ListShell>
  )
}
