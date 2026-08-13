import { DetailShell } from '@/components/archetypes'
import { CampaignDetailSkeleton } from '@/components/app/CampaignDetailSkeleton'

// Content-matched loading state for The Second Conversation campaign detail page.
export default function Loading() {
  return (
    <DetailShell title="The Second Conversation" description="Loading campaign details…">
      <CampaignDetailSkeleton />
    </DetailShell>
  )
}
