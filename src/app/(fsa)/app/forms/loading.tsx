import { ListSkeleton } from '@/components/archetypes'

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <ListSkeleton rows={6} />
    </div>
  )
}
