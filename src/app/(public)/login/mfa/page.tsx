import { Suspense } from 'react'
import { AuthShell } from '@/components/archetypes'
import { MfaForm } from '@/components/auth/MfaForm'

export const metadata = { title: 'Verify — FSOS' }
// The client form reads ?next= via useSearchParams and talks to Supabase → dynamic.
export const dynamic = 'force-dynamic'

// TOTP two-factor (middleware-auth.md §7). <MfaForm/> handles first-time
// enrollment (QR) and the returning-user challenge, both ending at aal2.
// Super-admin step-up reuses the same flow.
export default function MfaPage() {
  return (
    <AuthShell title="Two-factor verification" description="Confirm it's you with your authenticator app.">
      <Suspense fallback={null}>
        <MfaForm />
      </Suspense>
    </AuthShell>
  )
}
