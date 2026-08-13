import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Contacts are unified onto the CRM book (households) as the single source of truth.
// The flat Contact Center store stays as import-staging that always materializes into
// the book; its standalone list is folded in, so the bare /app/contacts index now
// redirects to the book. Sub-routes (/app/contacts/segments, /review, /[id], /new)
// are unaffected. Legacy deep links that filtered the flat list by campaign source map
// onto the book's Win-Back saved view.
export default async function ContactCenterRedirect({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string }>
}) {
  const sp = (await searchParams) ?? {}
  const target = sp.source === 'winback_life' ? '/app/households?view=win-back' : '/app/households'
  redirect(target)
}
