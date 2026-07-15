import { ListShell, ListSkeleton } from '@/components/archetypes'

export default function Loading() {
  return (
    <ListShell title="Financial Reviews" description="Where needs are discovered and opportunities originate.">
      <ListSkeleton rows={8} />
    </ListShell>
  )
}
