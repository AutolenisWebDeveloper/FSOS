import Link from 'next/link'
import { AuthShell } from '@/components/archetypes'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Verify email — FSOS' }

export default function VerifyPage({ params }: { params: { token: string } }) {
  // The token is exchanged server-side when the verification flow lands; this
  // page confirms receipt and offers the next action (no dead end).
  void params.token
  return (
    <AuthShell title="Verifying your email" description="Your email verification is being processed.">
      <Button asChild className="w-full">
        <Link href="/login">Continue to sign in</Link>
      </Button>
    </AuthShell>
  )
}
