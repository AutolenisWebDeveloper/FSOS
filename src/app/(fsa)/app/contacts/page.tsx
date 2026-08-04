import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Terminology reconciliation (Contacts & Contact 360 redesign §1/§2): the CRM's
// canonical "Contacts" surface is the household aggregate at /app/households
// (labeled "Contacts"), so the bare /app/contacts list redirects there — the
// households list + saved views (§4.1) supersede the flat contact list. The
// operational sub-surfaces (segments, import review, contact detail, add, import,
// upload) remain live and are reachable from the unified Contacts workspace nav.
export default function ContactsListRedirect() {
  redirect('/app/households')
}
