// src/lib/fna/report-pdf.tsx
// The client-facing FNA PDF (build instruction §7), rendered server-side from an
// APPROVED version via @react-pdf/renderer. Content comes from the pure report
// model (report.ts) so the PDF, the Excel package, and the HTML report all show
// the same traceable figures. Uses Farmers-blue accents (report brand); no
// hardcoded product colors beyond the report's own palette constants.
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { ReportSection } from './report'
import { REPORT_DISCLOSURE } from './report'

const NAVY = '#1C428B'
const INK = '#1a2233'
const MUTED = '#5b6472'
const LINE = '#dbe1ea'

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10, color: INK, fontFamily: 'Helvetica' },
  h1: { fontSize: 18, color: NAVY, fontFamily: 'Helvetica-Bold' },
  meta: { fontSize: 9, color: MUTED, marginTop: 4 },
  sectionTitle: { fontSize: 12, color: NAVY, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  section: { marginTop: 16, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  label: { color: MUTED },
  value: { fontFamily: 'Helvetica-Bold' },
  tag: { fontSize: 8, color: MUTED, marginTop: 4 },
  disclosure: { position: 'absolute', bottom: 28, left: 44, right: 44, fontSize: 8, color: MUTED, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
  draft: { position: 'absolute', top: 40, right: 44, fontSize: 9, color: '#a20f30', fontFamily: 'Helvetica-Bold' },
})

export interface ReportPdfProps {
  householdName: string
  planTypeLabel: string
  versionNo: number
  engineVersion: string
  assumptionSetVersion: string
  approved: boolean
  sections: ReportSection[]
}

export function FnaReportPdf(props: ReportPdfProps) {
  return (
    <Document title={`FNA — ${props.householdName}`}>
      <Page size="LETTER" style={s.page}>
        {!props.approved ? <Text style={s.draft}>DRAFT — NOT APPROVED</Text> : null}
        <Text style={s.h1}>Financial Needs Analysis</Text>
        <Text style={s.meta}>
          {props.householdName} · {props.planTypeLabel} · version {props.versionNo} · engine {props.engineVersion} · assumptions {props.assumptionSetVersion}
        </Text>
        <Text style={s.meta}>Analysis only — not a product recommendation or suitability determination.</Text>

        {props.sections.map((sec) => (
          <View key={sec.formulaId} style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>{sec.label}</Text>
            {sec.rows.map((r, i) => (
              <View key={i} style={s.row}>
                <Text style={s.label}>{r.label}</Text>
                <Text style={s.value}>{r.value}</Text>
              </View>
            ))}
            <Text style={s.tag}>
              {sec.formulaId}@{sec.version} · {sec.confidence} confidence
              {sec.assumptions.length > 0 ? ` · assumptions: ${sec.assumptions.map((a) => `${a.label} ${a.value}`).join(', ')}` : ''}
              {sec.missing.length > 0 ? ` · missing: ${sec.missing.join(', ')}` : ''}
            </Text>
          </View>
        ))}

        <Text style={s.disclosure} fixed>
          {REPORT_DISCLOSURE}
        </Text>
      </Page>
    </Document>
  )
}
