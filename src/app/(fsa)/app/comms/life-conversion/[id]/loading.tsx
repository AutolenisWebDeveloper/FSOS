import { DetailShell } from '@/components/archetypes'
import { CampaignDetailSkeleton } from '@/components/app/CampaignDetailSkeleton'

// Content-matched loading state for the Life Conversion campaign detail page (§13.1/§21).
export default function Loading() {
  return (
    <DetailShell title="Life Conversion Campaign" description="Loading campaign details…">
      <CampaignDetailSkeleton />
    </DetailShell>
  )
}
