import { AuthShell } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const metadata = { title: 'Set a new password — FSOS' }

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  return (
    <AuthShell title="Set a new password" description="Choose a strong password you haven't used before.">
      <form className="space-y-4">
        <input type="hidden" name="token" value={params.token} />
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
        <Button type="submit" className="w-full">
          Update password
        </Button>
      </form>
    </AuthShell>
  )
}
