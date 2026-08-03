'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/forms/Field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ROLES, type Role } from '@/lib/auth/rbac'
import { ROLE_LABELS } from '@/lib/auth/role-labels'
import { patchJson, deleteJson, firstFieldError } from '@/lib/client/api'

export interface UserRowActionsUser {
  id: string
  email: string | null
  roles: string[]
  securitiesScope: boolean
}

const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r)

export function UserRowActions({ user, isSelf }: { user: UserRowActionsUser; isSelf: boolean }) {
  const router = useRouter()
  const label = user.email ?? user.id

  // ── Edit dialog state ──
  const [editOpen, setEditOpen] = React.useState(false)
  const [roles, setRoles] = React.useState<Role[]>(user.roles.filter(isRole))
  const [scope, setScope] = React.useState(user.securitiesScope)
  const [rolesError, setRolesError] = React.useState<string | undefined>()
  const [saving, setSaving] = React.useState(false)

  // ── Delete dialog state ──
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  // Reset the edit form to the row's current values whenever it opens.
  function openEdit() {
    setRoles(user.roles.filter(isRole))
    setScope(user.securitiesScope)
    setRolesError(undefined)
    setEditOpen(true)
  }

  function toggleRole(role: Role, checked: boolean) {
    setRoles((prev) => (checked ? [...prev, role] : prev.filter((r) => r !== role)))
  }

  async function saveEdit() {
    if (roles.length === 0) {
      setRolesError('Select at least one role.')
      return
    }
    setRolesError(undefined)
    setSaving(true)
    const res = await patchJson<{ user: { id: string } }>(`/api/super/users/${user.id}`, {
      roles,
      securities_scope: scope,
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Updated ${label}.`)
    setEditOpen(false)
    router.refresh()
  }

  async function confirmDelete() {
    setDeleting(true)
    const res = await deleteJson<{ ok: true }>(`/api/super/users/${user.id}`)
    setDeleting(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Deleted ${label}.`)
    setDeleteOpen(false)
    router.refresh()
  }

  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" onClick={openEdit}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => setDeleteOpen(true)}
        disabled={isSelf}
        title={isSelf ? 'You can’t delete your own account.' : undefined}
      >
        Delete
      </Button>

      {/* Edit roles + securities scope */}
      <Dialog open={editOpen} onOpenChange={(o) => !saving && setEditOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit access</DialogTitle>
            <DialogDescription className="break-all">{label}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field id={`roles-${user.id}`} label="Roles" required error={rolesError} hint="Roles grant portal access.">
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

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={scope} onChange={(e) => setScope(e.target.checked)} />
              Grant securities scope
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription className="break-all">
              This permanently removes <span className="font-medium">{label}</span> and revokes their access. This
              can’t be undone. Their historical activity and audit records are preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
