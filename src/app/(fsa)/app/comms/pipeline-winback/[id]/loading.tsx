import { DetailShell } from '@/components/archetypes'
import { CampaignDetailSkeleton } from '@/components/app/CampaignDetailSkeleton'
import { CAMPAIGN_ENGINES } from '@/lib/comms/campaign-presentation'

// Content-matched loading state for the Pipeline Win-Back campaign detail page (§13.1/§21).
// The engine title stands in for the campaign's own name, which is not known until the
// record loads — an honest placeholder rather than a guess.
const ENGINE = CAMPAIGN_ENGINES.pipeline_winback

export default function Loading() {
  return (
    <DetailShell title={ENGINE.title} description="Loading campaign details…">
      <CampaignDetailSkeleton />
    </DetailShell>
  )
}
