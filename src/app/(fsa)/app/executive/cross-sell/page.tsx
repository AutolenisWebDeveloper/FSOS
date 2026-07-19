import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
// Executive cross-sell overview → the Cross-Sell analytics.
export default function Page() { redirect('/app/cross-sell/analytics') }
