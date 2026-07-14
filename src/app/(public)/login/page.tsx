import Link from 'next/link'
import { AuthShell } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const metadata = { title: 'Sign in — FSOS' }

// A13 auth page. Foundation renders the form + recovery links; the Supabase
// email/password + MFA challenge wiring lands with the auth flow. Rate limiting
// and bot protection are applied at the middleware/edge layer.
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
      <form className="space-y-4" action="/login/mfa">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </AuthShell>
  )
}
