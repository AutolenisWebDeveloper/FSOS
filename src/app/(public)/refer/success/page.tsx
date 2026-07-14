import { CompletionScreen } from '@/components/archetypes'

export const metadata = { title: 'Referral received — FSOS' }

// A9 completion screen for the public referral flow. Always offers a next action.
export default function ReferSuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <CompletionScreen
        title="Referral received"
        description="Thank you — the FSA team will follow up."
        nextActions={[
          { label: 'Submit another', href: '/refer' },
          { label: 'Home', href: '/' },
        ]}
      />
    </main>
  )
}
