import { AuthShell } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const metadata = { title: 'Verify — FSOS' }

// TOTP challenge (middleware-auth.md §7). Super-admin uses this for step-up too.
export default function MfaPage() {
  return (
    <AuthShell title="Two-factor verification" description="Enter the 6-digit code from your authenticator app.">
      <form className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">Authentication code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </div>
        <Button type="submit" className="w-full">
          Verify
        </Button>
      </form>
    </AuthShell>
  )
}
