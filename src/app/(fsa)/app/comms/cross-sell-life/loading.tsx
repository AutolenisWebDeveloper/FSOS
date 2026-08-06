import { ListShell, ListSkeleton } from '@/components/archetypes'
import { CAMPAIGN_ENGINES } from '@/lib/comms/campaign-presentation'

// Content-matched loading state for the Cross-Sell Life operations dashboard (§13.1/§21 — a
// skeleton that mirrors the page shell, never a bare spinner). The title comes from the
// shared engine registry so it cannot drift from the loaded page: when the skeleton said
// "Cross-Sell Life Campaign" and the page said "Cross-Sell Life", the heading visibly changed as
// the load completed.
const ENGINE = CAMPAIGN_ENGINES.cross_sell_life

export default function Loading() {
  return (
    <ListShell title={ENGINE.title} description="Loading campaign operations…">
      <ListSkeleton rows={8} label={`Loading the ${ENGINE.title} campaign…`} />
    </ListShell>
  )
}
