import { AuthShell } from '@/components/archetypes'

export const metadata = { title: 'Offline — FSOS' }

export default function OfflinePage() {
  return (
    <AuthShell
      title="You're offline"
      description="We couldn't reach the network. Check your connection and try again."
    >
      <p className="text-center text-sm text-muted-foreground">This page will work again once you're back online.</p>
    </AuthShell>
  )
}
