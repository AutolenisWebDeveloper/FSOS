import { redirect } from 'next/navigation'
export const dynamic = 'force-dynamic'
// Executive conversion overview → the Term Conversion analytics.
export default function Page() { redirect('/app/conversions/analytics') }
