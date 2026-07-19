import Link from 'next/link'
import { Suspense } from 'react'
import { AuthShell } from '@/components/archetypes'
import { LoginForm } from '@/components/auth/LoginForm'

export const metadata = { title: 'Sign in — FSOS' }
// The client form reads ?next= via useSearchParams → render dynamically.
export const dynamic = 'force-dynamic'

// A13 auth page. Real Supabase email/password sign-in lives in <LoginForm/>; the
// MFA challenge/enroll is the next step (/login/mfa). Rate limiting and bot
// protection are applied at the middleware/edge layer.
export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in to FSOS"
      description="Private internal system. Authorized users only."
      footer={
        <span>
          <Link href="/forgot-password" className="text-primary hover:underline">
            Forgot password?
          </Link>
        </span>
      }
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
