import { PageHeader, Section, CardsSkeleton, ListSkeleton } from '@/components/archetypes'

// Suspense fallback for the /app/fna overview (page.tsx = AI FNA Command Center).
// Mirrors the real overview: 4-up stat row → module grid → recent-plans list, so
// the shell doesn't shift when data resolves.
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI FNA Command Center"
        description="Structured, deterministic financial planning. Every figure traces to a formula, its version, the inputs, and the assumptions used."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center' }]}
      />
      <CardsSkeleton count={4} label="Loading planning summary…" />
      <Section title="Planning modules" description="Every analysis and workspace across the command center.">
        <ListSkeleton rows={4} label="Loading modules…" />
      </Section>
      <Section title="Recent plans" description="The latest planning activity across households.">
        <ListSkeleton rows={6} label="Loading recent plans…" />
      </Section>
    </div>
  )
}
