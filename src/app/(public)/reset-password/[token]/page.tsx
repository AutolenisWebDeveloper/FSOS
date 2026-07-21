import Link from 'next/link'
import { AuthShell } from '@/components/archetypes'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

export const metadata = { title: 'Set a new password — FSOS' }
// The client form completes the Supabase recovery session in the browser.
export const dynamic = 'force-dynamic'

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      description="Choose a strong password you haven’t used before."
      footer={
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ResetPasswordForm />
    </AuthShell>
  )
}
