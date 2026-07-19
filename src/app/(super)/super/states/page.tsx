import { SettingsShell, SettingsSection, AssumptionBadge } from '@/components/archetypes'
export const dynamic = 'force-dynamic'
// P-6 States (A10). Rules + quiet hours per state (config defaults).
export default function SuperStatesPage() {
  return (
    <SettingsShell title="States" description="State rules and quiet hours (config defaults).">
      <SettingsSection title="Quiet hours">
        <div className="flex items-center gap-2 text-sm"><span>Conservative floor: 9:00–20:00 recipient-local</span><AssumptionBadge label="config floor — verify per state" /></div>
        <p className="text-xs text-muted-foreground">TX SB 140 / TCPA and per-state rules are the configured compliance floor — counsel confirms specifics. The dispatcher enforces quiet hours at send time.</p>
      </SettingsSection>
    </SettingsShell>
  )
}
