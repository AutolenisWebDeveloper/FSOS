'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/forms/Field'
import { ROLES, type Role } from '@/lib/auth/rbac'
import { UserCreateSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

// Human labels for the fixed RBAC role set (rbac.ts is the source of truth for the keys).
const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  fsa: 'FSA',
  licensed_staff: 'Licensed Staff',
  admin: 'Admin / Back-office',
  ops: 'Operations',
  case_manager: 'Case Manager',
  compliance: 'Compliance',
  supervisor: 'Supervisor',
  agency_owner: 'Agency Owner',
  client: 'Client',
}

interface CreateUserResponse {
  user: { id: string; email: string; roles: string[] }
  emailStatus: 'sent' | 'not_configured' | 'send_failed' | 'link_failed'
}

export function CreateUserForm() {
  const router = useRouter()
  const [email, setEmail] = React.useState('')
  const [roles, setRoles] = React.useState<Role[]>([])
  const [securitiesScope, setSecuritiesScope] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  function toggleRole(role: Role, checked: boolean) {
    setRoles((prev) => (checked ? [...prev, role] : prev.filter((r) => r !== role)))
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const payload = { email, roles, securities_scope: securitiesScope }
    const parsed = UserCreateSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      return
    }

    setSaving(true)
    const res = await postJson<CreateUserResponse>('/api/super/users', parsed.data)
    setSaving(false)

    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }

    const created = res.data.user.email
    if (res.data.emailStatus === 'sent') {
      toast.success(`User created — a password-setup email is on its way to ${created}.`)
    } else {
      toast.success(`User ${created} created.`)
      toast('Password-setup email not sent', {
        description:
          'Email isn’t fully configured, so no setup link was delivered. Ask the user to use “Forgot password” on the sign-in page to set their password.',
      })
    }

    setEmail('')
    setRoles([])
    setSecuritiesScope(false)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field
        id="email"
        label="Email"
        required
        error={errors.email}
        hint="The user’s sign-in address. They’ll receive a secure link to set their own password."
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
        />
      </Field>

      <Field id="roles" label="Roles" required error={errors.roles} hint="Roles grant portal access. Choose one or more.">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={roles.includes(role)}
                onChange={(e) => toggleRole(role, e.target.checked)}
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </Field>

      <Field
        id="securities_scope"
        label="Securities scope"
        error={errors.securities_scope}
        hint="Grants the securities-scope flag (app_metadata). Leave off unless this user handles securities-scoped work."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={securitiesScope}
            onChange={(e) => setSecuritiesScope(e.target.checked)}
          />
          Grant securities scope
        </label>
      </Field>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create user & send setup link'}
        </Button>
      </div>
    </form>
  )
}
