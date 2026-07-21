import Link from 'next/link'
import { AuthShell } from '@/components/archetypes'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export const metadata = { title: 'Reset password — FSOS' }
// The client form calls Supabase auth in the browser → render dynamically.
export const dynamic = 'force-dynamic'

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your email and we’ll send a reset link if the account exists."
      footer={
        <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
          <span aria-hidden className="text-border">
            ·
          </span>
          <a href="https://www.markistfsa.com" className="text-muted-foreground hover:text-foreground hover:underline">
            Return to markistfsa.com
          </a>
        </span>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
