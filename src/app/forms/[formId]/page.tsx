import { Suspense } from 'react'
import ClientFormPortal from '@/components/pages/ClientFormPortal'

// Public route — no auth required
export const dynamic = 'force-dynamic'

interface FormPageProps {
  params: { formId: string }
}

export default function FormPage({ params }: FormPageProps) {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f9' }}>
        <div style={{ color: '#6b7a8d', fontFamily: 'sans-serif' }}>Loading…</div>
      </div>
    }>
      <ClientFormPortal formId={params.formId} />
    </Suspense>
  )
}
