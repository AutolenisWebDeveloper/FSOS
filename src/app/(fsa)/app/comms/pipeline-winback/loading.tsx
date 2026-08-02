import { DetailShell } from '@/components/archetypes'
import { CampaignDetailSkeleton } from '@/components/app/CampaignDetailSkeleton'

// Content-matched loading state for the Pipeline Win-Back campaign detail page (§13.1/§21).
export default function Loading() {
  return (
    <DetailShell title="Win-Back Campaign" description="Loading campaign details…">
      <CampaignDetailSkeleton />
    </DetailShell>
  )
}
