import Link from 'next/link'
import { AuthShell } from '@/components/archetypes'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Access denied — FSOS' }

// Rendered (via middleware rewrite) when a role is not permitted for a portal, or
// when a layout guard denies a forbidden deep link. Never a blank page.
export default function ForbiddenPage() {
  return (
    <AuthShell title="Access denied" description="Your role doesn't permit this resource.">
      <div className="space-y-2">
        <Button asChild className="w-full">
          <Link href="/login">Sign in with a different account</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/support">Contact support</Link>
        </Button>
      </div>
    </AuthShell>
  )
}
