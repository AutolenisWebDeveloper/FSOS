import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConsentForm } from '@/components/public/ConsentForm'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Contact preferences — FSOS' }

// Public, unauthenticated consent / do-not-contact page. An optional ?token= is
// displayed for reference only (no lookup — no PII is surfaced from a raw token).
export default function ConsentPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === 'string' ? searchParams.token : undefined
  return (
    <main className="flex min-h-screen items-start justify-center bg-muted/30 p-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-lg">Manage your contact preferences</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ask us to stop contacting you. Choose a channel and we&apos;ll add you to our internal do-not-contact list.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {token ? (
            <p className="rounded-md border bg-muted/40 p-2 text-center text-xs text-muted-foreground">
              Reference: {token}
            </p>
          ) : null}
          <ConsentForm />
        </CardContent>
      </Card>
    </main>
  )
}
