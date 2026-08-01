import { ListShell, ListSkeleton } from '@/components/archetypes'

// Content-matched loading state for the Cross-Sell Life operations dashboard (§13.1/§21 —
// a skeleton that mirrors the page shell, never a bare spinner). The comms subtree's error.tsx
// covers the failure path; this covers the pending path.
export default function Loading() {
  return (
    <ListShell title="Cross-Sell Life Campaign" description="Loading campaign operations…">
      <ListSkeleton rows={8} label="Loading the Cross-Sell Life Campaign…" />
    </ListShell>
  )
}
