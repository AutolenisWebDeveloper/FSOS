'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LogOut, KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBrowserClient } from '@/lib/supabase/browser'

/**
 * Client-side account actions for the settings page. Both operations go through
 * the existing cookie-backed Supabase auth client — no new backend surface:
 *  • password reset → Supabase sends the branded reset email to the user;
 *  • sign out → clears the session and returns to /login.
 */
export function AccountActions({ email }: { email: string | null }) {
  const router = useRouter()
  const [resetting, setResetting] = React.useState(false)
  const [signingOut, setSigningOut] = React.useState(false)

  async function sendReset() {
    if (!email) {
      toast.error('No email on this account to send a reset link to.')
      return
    }
    setResetting(true)
    try {
      const supabase = getBrowserClient()
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      if (error) throw error
      toast.success(`Password reset link sent to ${email}.`)
    } catch {
      toast.error('Could not send the reset link. Try again shortly.')
    } finally {
      setResetting(false)
    }
  }

  async function signOut() {
    setSigningOut(true)
    try {
      await getBrowserClient().auth.signOut()
    } catch {
      /* fall through to redirect regardless */
    }
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={sendReset} disabled={resetting}>
        {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Send password reset link
      </Button>
      <Button type="button" variant="destructive" onClick={signOut} disabled={signingOut}>
        {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        {signingOut ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  )
}
