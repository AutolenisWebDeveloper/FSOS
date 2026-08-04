import Link from 'next/link'
import { Upload, Users, FileText, Building2, BookOpen, RefreshCw, Undo2, Sparkles, ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ListShell } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { KNOWN_TEMPLATES } from '@/lib/import/mapping/templates'

export const dynamic = 'force-dynamic'

// Upload Center (redesign spec §7) — the SINGLE platform-wide entry point for
// every upload in FSOS. It does not re-implement the importers (architecture
// preservation §6): it is the consolidating on-ramp that routes each workflow to
// its existing, intelligent importer. The contacts importer already fingerprints
// headers and auto-detects the five district templates (KNOWN_TEMPLATES), applies
// saved mappings + per-header memory, splits composites (AOR+Series Code), folds
// owner + joint owner into one household, and dedupes — all surfaced here.
export default function UploadCenterPage() {
  return (
    <ListShell
      title="Upload Center"
      description="The single entry point for every upload in FSOS — contacts, documents, policies, and bulk data."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Upload Center' }]}
    >
      <div className="space-y-6">
        {/* Primary on-ramp: intelligent contact & book-data import. */}
        <Card className="border-primary/25 bg-primary-soft/15">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" aria-hidden /> Import contacts &amp; book data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Drop a district export and the importer fingerprints its headers, auto-detects the template, and applies
              your saved mapping. It splits composite columns (AOR + Series Code), folds an owner and joint owner into
              one household, and dedupes on policy&nbsp;#, email, and phone. Map an unknown header once — it&apos;s
              remembered next time. Output lands as Households, Members, Policies, LOB tags, and AOR.
            </p>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> Auto-detected district templates
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {KNOWN_TEMPLATES.map((t) => (
                  <li key={t.key} className="rounded-lg border bg-card px-3 py-2">
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.shape}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/app/contacts/import">
                  Import contacts <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/app/contacts/review">Review pending imports</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Other upload workflows — each routes to its existing importer. */}
        <div>
          <h2 className="mb-3 text-sm font-semibold">Other upload workflows</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UploadCard icon={FileText} title="Documents" description="Household and case documents; signed-URL sharing." href="/app/documents" />
            <UploadCard icon={Building2} title="Agencies" description="Bulk-import agency partnerships and owners." href="/app/agencies/import" />
            <UploadCard icon={BookOpen} title="Book of business" description="In-force book export — policies and coverage." href="/app/book/import" />
            <UploadCard icon={RefreshCw} title="Life conversions" description="Term-conversion policy detail and convertible lists." href="/app/conversions/import" />
            <UploadCard icon={Undo2} title="Win-back" description="Inactive-LOB lists for re-engagement." href="/app/winback/import" />
          </div>
        </div>
      </div>
    </ListShell>
  )
}

function UploadCard({ icon: Icon, title, description, href }: { icon: LucideIcon; title: string; description: string; href: string }) {
  return (
    <Link href={href} className="group rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-primary-soft/20">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="font-medium">{title}</span>
        <Upload className="ml-auto h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </Link>
  )
}
