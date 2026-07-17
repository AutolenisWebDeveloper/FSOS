import { requireRole } from '@/lib/auth/session'
import { PageHeader } from '@/components/archetypes'
import { GlobalSearch } from '@/components/app/GlobalSearch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Global search page (ports the legacy top-bar search). The results API is
// RLS-scoped and firewall-safe (see /api/app/search). Roles: fsa, licensed_staff,
// super_admin (portal-gated by the (fsa) layout).
export default async function SearchPage(props: { searchParams: Promise<{ q?: string }> }) {
  const searchParams = await props.searchParams;
  await requireRole('fsa', '/app/search')
  const initial = typeof searchParams.q === 'string' ? searchParams.q : ''
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Search"
        description="Find any household, member, agency, or referral in your book."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Search' }]}
      />
      <GlobalSearch initialQuery={initial} />
    </div>
  )
}
