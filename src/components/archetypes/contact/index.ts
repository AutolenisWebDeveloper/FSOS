// Contact 360 shared design-system components (redesign spec §12 — mandatory
// reuse). Every customer-displaying surface (the record, Member Detail, the
// Contact Peek, and any work-item that shows a person) consumes these; no page
// builds its own customer header, status row, action bar, section nav, or
// timeline. Re-exported from '@/components/archetypes'.
export {
  CONTACT_SECTIONS,
  CONTACT_SECTION_IDS,
  ContactSectionNav,
  isContactSection,
  type ContactSection,
} from './section-nav'
export { ContactStatusRow } from './status-row'
export { ContactTimeline } from './timeline'
export { ContactActionBar } from './action-bar'
export { ContactPeek, ContactPeekProvider, useContactPeek } from './peek'
export { ContactAdvisor } from './advisor'
export { ContactRelationshipGraph } from './relationship-graph'
export { NoteComposer, AddNoteButton, ContactTimelinePanel, type NoteRecord, type ActivityRecord } from './notes'
