import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The Social overview dashboard is built in slice 3 (scheduling). Until then the
// module entry point routes to the one built surface — connected accounts.
export default async function SocialIndexPage() {
  await requireRole('fsa', '/app/social')
  redirect('/app/social/accounts')
}
