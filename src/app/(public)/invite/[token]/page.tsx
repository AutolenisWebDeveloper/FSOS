import { AuthShell } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const metadata = { title: 'Accept invitation — FSOS' }

// A6-style accept-invite (sitemap P-0). Sets password + enrolls MFA on submit.
export default async function InvitePage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  return (
    <AuthShell title="Accept your invitation" description="Set a password to activate your FSOS account.">
      <form className="space-y-4">
        <input type="hidden" name="token" value={params.token} />
        <div className="space-y-1.5">
          <Label htmlFor="password">Create password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <Button type="submit" className="w-full">
          Activate account
        </Button>
      </form>
    </AuthShell>
  )
}
