import { notFound, redirect } from 'next/navigation'
import { HouseholdProfile, HOUSEHOLD_SECTION_ALIASES } from '@/components/app/HouseholdProfile'
import { CONTACT_SECTION_IDS, isContactSection } from '@/components/archetypes'

export const dynamic = 'force-dynamic'

// The Contact 360 record's non-overview sections (redesign spec §4.2). Overview
// lives at the record root; the other five canonical sections resolve here.
// Legacy segments (members, policies, …) redirect to their canonical section so
// old bookmarks and deep links never 404 (§16 — nothing removed, only regrouped).
export default async function HouseholdSectionPage(props: { params: Promise<{ id: string; tab: string }> }) {
  const { id, tab } = await props.params

  // Overview is served at the record root, not as a section segment.
  if (tab === 'overview') redirect(`/app/households/${id}`)

  const alias = HOUSEHOLD_SECTION_ALIASES[tab]
  if (alias && alias !== tab) redirect(`/app/households/${id}/${alias}`)

  if (!isContactSection(tab)) notFound()
  // Redundant guard kept explicit for the type-checker / future edits.
  if (!(CONTACT_SECTION_IDS as readonly string[]).includes(tab)) notFound()

  return <HouseholdProfile id={id} section={tab} />
}
