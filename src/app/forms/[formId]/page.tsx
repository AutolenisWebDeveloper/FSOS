import { getDb } from '@/lib/supabase/client'
import { PublicForm, type PublicFormField } from '@/components/public/PublicForm'
import { PublicPage, PublicBrandLockup } from '@/components/public/PublicShell'

// Public route — no auth required (on the public allowlist). Restyled to the FSOS
// design language (docs/legacy-port.md §2.3). Loads a form_templates row by its
// public slug and renders the intake form. Consent is captured on submit; no
// securities data is collected on any public form (guardrail §2.1).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface FormPageProps {
  params: Promise<{ formId: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function FormPage(props: FormPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  let template: {
    slug: string
    name: string
    description: string | null
    captures_consent: boolean
    fields: PublicFormField[]
  } | null = null
  let loadError = false

  try {
    const { data } = await getDb()
      .from('form_templates')
      .select('slug, name, description, captures_consent, fields, active')
      .eq('slug', params.formId)
      .maybeSingle()
    if (data && data.active) {
      template = {
        slug: data.slug,
        name: data.name,
        description: data.description,
        captures_consent: data.captures_consent,
        fields: Array.isArray(data.fields) ? (data.fields as PublicFormField[]) : [],
      }
    }
  } catch {
    loadError = true
  }

  return (
    <PublicPage>
      <div className="w-full max-w-lg">
        <PublicBrandLockup />

        {template ? (
          <PublicForm template={template} token={searchParams.token} />
        ) : (
          <div className="rounded-xl border border-border bg-card p-8 text-center shadow-elev-xs">
            <h1 className="text-lg font-semibold text-foreground">Form unavailable</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {loadError
                ? 'We could not load this form right now. Please try again later.'
                : 'This form link is not active. Please contact your specialist for a current link.'}
            </p>
          </div>
        )}
      </div>
    </PublicPage>
  )
}
