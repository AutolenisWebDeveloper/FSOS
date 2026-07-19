import { ListShell, ListSkeleton } from '@/components/archetypes'

export default function Loading() {
  return (
    <ListShell title="Referral Inbox" description="Loading…">
      <ListSkeleton rows={8} />
    </ListShell>
  )
}
