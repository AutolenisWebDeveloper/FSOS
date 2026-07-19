'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Numeric } from '@/components/ui/typography'

/** Role-gated, audited DOB reveal (A3). The decrypt + audit happen server-side. */
export function MemberDobReveal({ householdId, memberId }: { householdId: string; memberId: string }) {
  const [dob, setDob] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [revealed, setRevealed] = React.useState(false)

  async function reveal() {
    setLoading(true)
    const res = await fetch(`/api/households/${householdId}/members/${memberId}?dob=1`)
    setLoading(false)
    if (!res.ok) {
      toast.error('Not permitted to view date of birth')
      return
    }
    const json = await res.json()
    setDob(json.member?.dob ?? null)
    setRevealed(true)
  }

  if (revealed) {
    return <Numeric className="font-medium">{dob ? new Date(dob).toLocaleDateString('en-US') : 'Not on file'}</Numeric>
  }
  return (
    <Button variant="outline" size="sm" onClick={reveal} disabled={loading}>
      {loading ? 'Decrypting…' : 'Reveal DOB'}
    </Button>
  )
}
