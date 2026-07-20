'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Video, MapPin, Users, Radio, CheckCircle2, AlertTriangle, Star, RefreshCw, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'

// P3 staff Delivery panel (workshop detail). Read-only rollup of the virtual-delivery
// pipeline — per-session Zoom/recording status, per-registrant provisioning progress with a
// retry action, attendance capture-method mix, feedback results, and the recording-consent
// activation gate. Every figure is real data passed from the server loader.
export interface DeliverySummaryProps {
  workshopId: string
  slug: string | null
  summary: {
    sessions: {
      id: string
      starts_at: string
      delivery_mode: string | null
      zoom_meeting_id: string | null
      recording_url: string | null
      recording_expires_at: string | null
      status: string | null
    }[]
    hasVirtual: boolean
    virtualRegs: number
    provisioned: number
    captureCounts: { webhook: number; checkin: number; manual: number }
    feedback: { count: number; avgRating: number | null; consultRequested: number }
    recordingConsentApproved: boolean
    zoomEnabled: boolean
  }
}

export function WorkshopDeliveryPanel({ workshopId, slug, summary }: DeliverySummaryProps) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function provision() {
    setBusy(true)
    const res = await postJson<{ provisioned: number; skipped: number; failed: number; zoom_enabled: boolean; note?: string }>(
      `/api/workshops/${workshopId}/provision-zoom`,
    )
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (!res.data.zoom_enabled) {
      toast.message('Zoom is not configured', { description: res.data.note ?? 'Set ZOOM_* env vars to enable provisioning.' })
      return
    }
    toast.success(`Provisioned ${res.data.provisioned} · skipped ${res.data.skipped} · failed ${res.data.failed}`)
    router.refresh()
  }

  const s = summary
  const provisionPct = s.virtualRegs > 0 ? Math.round((s.provisioned / s.virtualRegs) * 100) : null

  return (
    <div className="space-y-5">
      {/* Zoom configuration status */}
      {!s.zoomEnabled ? (
        <div className="flex items-start gap-2 rounded-md border border-status-pending/30 bg-status-pending/10 px-3 py-2 text-xs text-status-pending">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Zoom is not configured — provisioning + the attendance webhook stay dormant until the <span className="numeric">ZOOM_*</span> credentials are set.</span>
        </div>
      ) : null}

      {/* Sessions + Zoom / recording pointers */}
      <section className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sessions</h4>
        {s.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions scheduled.</p>
        ) : (
          <ul className="space-y-2">
            {s.sessions.map((sess) => {
              const Icon = sess.delivery_mode === 'virtual' ? Video : sess.delivery_mode === 'hybrid' ? Users : MapPin
              return (
                <li key={sess.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {new Date(sess.starts_at).toLocaleString()}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                        {(sess.delivery_mode ?? 'in_person').replace('_', ' ')}
                      </span>
                    </span>
                    {sess.delivery_mode !== 'in_person' ? (
                      <span className="text-xs text-muted-foreground">
                        {sess.zoom_meeting_id ? (
                          <>Zoom mtg <span className="numeric">{sess.zoom_meeting_id}</span></>
                        ) : (
                          <span className="text-status-pending">No Zoom meeting id set</span>
                        )}
                      </span>
                    ) : null}
                  </div>
                  {sess.delivery_mode !== 'in_person' ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {sess.recording_url ? (
                        <>Recording captured{sess.recording_expires_at ? ` · available through ${new Date(sess.recording_expires_at).toLocaleDateString()}` : ''}.</>
                      ) : (
                        'No recording captured yet.'
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Provisioning progress + retry */}
      {s.hasVirtual ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Join-link provisioning</h4>
            <Button size="sm" variant="outline" onClick={provision} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              Provision Zoom links
            </Button>
          </div>
          <p className="text-sm text-foreground">
            <span className="numeric">{s.provisioned}</span> of <span className="numeric">{s.virtualRegs}</span> virtual registrants provisioned
            {provisionPct !== null ? <span className="text-muted-foreground"> ({provisionPct}%)</span> : null}
          </p>
          {s.provisioned < s.virtualRegs ? (
            <p className="text-xs text-muted-foreground">
              Unprovisioned registrants keep their registration; retry provisions their personalized join link (nothing is lost).
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Attendance capture-method mix */}
      <section className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attendance capture</h4>
        <div className="flex flex-wrap gap-2 text-xs">
          <CaptureChip icon={Radio} label="Webhook (Zoom)" n={s.captureCounts.webhook} />
          <CaptureChip icon={CheckCircle2} label="Check-in" n={s.captureCounts.checkin} />
          <CaptureChip icon={Users} label="Manual" n={s.captureCounts.manual} />
        </div>
        <p className="text-xs text-muted-foreground">A staff manual mark always takes precedence over a later Zoom webhook event.</p>
      </section>

      {/* Feedback rollup */}
      <section className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feedback</h4>
        {s.feedback.count === 0 ? (
          <p className="text-sm text-muted-foreground">No feedback submitted yet.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Star className="h-4 w-4 fill-primary text-primary" aria-hidden />
              {s.feedback.avgRating != null ? s.feedback.avgRating.toFixed(1) : '—'} avg
            </span>
            <span className="text-muted-foreground"><span className="numeric text-foreground">{s.feedback.count}</span> responses</span>
            <span className="text-muted-foreground"><span className="numeric text-foreground">{s.feedback.consultRequested}</span> consult requests</span>
          </div>
        )}
      </section>

      {/* Replay activation gate (recording-consent) */}
      <section className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Replay</h4>
        {s.recordingConsentApproved ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-status-won">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Recording-consent disclosure approved — replay can serve within its window.
          </p>
        ) : (
          <p className="inline-flex items-start gap-1.5 text-sm text-status-pending">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Blocked — replay cannot activate until an approved recording-consent disclosure is referenced.
          </p>
        )}
        {slug ? (
          <p className="text-xs text-muted-foreground">
            Public replay path: <span className="numeric">/workshops/{slug}/replay</span> (registrants open it from their personalized link).
          </p>
        ) : null}
      </section>
    </div>
  )
}

function CaptureChip({ icon: Icon, label, n }: { icon: LucideIcon; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}: <span className="numeric text-foreground">{n}</span>
    </span>
  )
}
