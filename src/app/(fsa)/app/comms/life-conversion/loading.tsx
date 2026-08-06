import { ListShell, ListSkeleton } from '@/components/archetypes'
import { CAMPAIGN_ENGINES } from '@/lib/comms/campaign-presentation'

// Content-matched loading state for the Life Conversion operations dashboard (§13.1/§21 — a
// skeleton that mirrors the page shell, never a bare spinner). The title comes from the
// shared engine registry so it cannot drift from the loaded page: when the skeleton said
// "Life Conversion Campaign" and the page said "Life Conversion", the heading visibly changed as
// the load completed.
const ENGINE = CAMPAIGN_ENGINES.life_conversion

export default function Loading() {
  return (
    <ListShell title={ENGINE.title} description="Loading campaign operations…">
      <ListSkeleton rows={8} label={`Loading the ${ENGINE.title} campaign…`} />
    </ListShell>
  )
}
