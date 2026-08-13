import { ListShell, ListSkeleton } from '@/components/archetypes'

// Content-matched loading state for The Second Conversation operations dashboard.
export default function Loading() {
  return (
    <ListShell title="The Second Conversation" description="Loading campaign operations…">
      <ListSkeleton rows={8} label="Loading the District Agent FS Nurture campaign…" />
    </ListShell>
  )
}
