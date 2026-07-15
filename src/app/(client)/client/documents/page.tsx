import { FormShell } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'
export const dynamic = 'force-dynamic'
// P-5 Documents (A5 upload). Virus-scanned, signed-URL storage, classified to the household/case.
export default function ClientDocumentsPage() {
  return (
    <FormShell title="Documents" description="Upload requested documents securely." breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Documents' }]}>
      <Card><CardContent className="space-y-2 py-6 text-sm"><p>Uploads are virus-scanned and stored securely against your case requirement. Malicious files are rejected.</p></CardContent></Card>
    </FormShell>
  )
}
