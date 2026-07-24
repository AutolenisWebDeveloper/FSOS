import { CommsSubnav } from '@/components/app/CommsSubnav'

// Slice 9A — the AI Communications Center wraps every comms route with a grouped
// sub-navigation so all surfaces (campaigns, conversations, templates, governance,
// insight) are reachable from within the hub. No route changes — this is a layout only.
export default function CommsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CommsSubnav />
      {children}
    </>
  )
}
