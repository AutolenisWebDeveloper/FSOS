import { ListShell, ListSkeleton } from '@/components/archetypes'

// Portal-level loading fallback: a skeleton (never a bare spinner) shown while a page in
// this route group streams its server data, so navigation feels instant (DESIGN.md
// loading ladder / §13.1). Section-level loading.tsx files override this where present.
export default function Loading() {
  return (
    <ListShell title="Compliance & Supervision" description="Loading…">
      <ListSkeleton rows={8} />
    </ListShell>
  )
}
