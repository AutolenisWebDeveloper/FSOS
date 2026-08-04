import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// "FFS Contacts" was renamed to the FFS Directory and moved to /app/directory
// (Contacts & Contact 360 redesign §1/§5) to resolve the terminology collision
// with the CRM Contacts/Household entity. Old deep links redirect so nothing 404s.
export default function LegacyFfsContactsRedirect() {
  redirect('/app/directory')
}
