import { PageHeader, CardsSkeleton } from '@/components/archetypes'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="FNA Generator"
        description="Generate a Financial Needs Analysis for a household — educational needs & gaps only, reviewed by a licensed FSA before it reaches a client."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'FNA Generator' }]}
      />
      <CardsSkeleton count={2} />
    </div>
  )
}
