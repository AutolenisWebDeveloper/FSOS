import { SocialSubnav } from '@/components/app/SocialSubnav'

// The AI Social Media Center wraps every social route with a grouped sub-navigation
// (Content · Publishing · Engagement · Insight · Setup) so all surfaces are reachable
// from within the hub — no more orphaned Calendar / Accounts. Layout only; no route
// changes. Mirrors the AI Communications Center layout (ADR-026).
export default function SocialLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SocialSubnav />
      {children}
    </>
  )
}
