import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PublicReferForm } from '@/components/public/PublicReferForm'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Make a referral — FSOS' }

// Public, unauthenticated referral intake (P0 public surface). No securities data
// is ever collected here.
export default function PublicReferPage() {
  return (
    <main className="flex min-h-screen items-start justify-center bg-muted/30 p-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-lg">Refer someone to us</CardTitle>
          <p className="text-sm text-muted-foreground">
            Tell us who to reach out to and we&apos;ll take it from there. Life and financial services only — no account
            or securities details.
          </p>
        </CardHeader>
        <CardContent>
          <PublicReferForm />
        </CardContent>
      </Card>
    </main>
  )
}
