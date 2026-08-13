// src/lib/workspaces/registry.ts
//
// The Workspace Registry — the single, static source of truth for the Advisor OS
// navigation layer (docs/redesign/route-workspace-matrix.md). A "workspace" is a
// PRESENTATION grouping of routes the current session can already reach; it adds
// NO route and NO authorization. Authorization stays a pure function of the URL
// prefix (src/lib/auth/rbac.ts `portalOf`), enforced by middleware + layout
// guards + RLS. See docs/redesign/security-audit-slice1.md.
//
// This module is intentionally SELF-CONTAINED (no runtime imports) so the
// invariant tests (tests/workspace-registry.test.mjs) can transpile it as a
// single file exactly like rbac.ts. Icons are string keys resolved to lucide
// components in the client shell (src/lib/workspaces/icons.ts). `WorkspacePortal`
// mirrors rbac.Portal; the shell consumer types workspace.portal as rbac.Portal,
// so any drift fails the build.

/** Mirrors the non-public portals in rbac.ts `Portal`. */
export type WorkspacePortal = 'fsa' | 'admin' | 'compliance' | 'partner' | 'client' | 'super'

export interface WorkspaceNavItem {
  href: string
  label: string
  /** lucide icon name (resolved in the shell). */
  icon: string
  /** Match this href exactly for active state (else prefix-match). */
  exact?: boolean
}

export interface Workspace {
  /** Stable id (kebab). */
  id: string
  label: string
  portal: WorkspacePortal
  /** Switcher section grouping. */
  section: string
  /** lucide icon name for the switcher. */
  icon: string
  /** Landing route ("home") for the workspace. */
  home: string
  /**
   * URL prefixes this workspace owns, for active-workspace resolution. The
   * workspace with the LONGEST matching prefix wins, so a broad fallback prefix
   * (e.g. '/app') coexists with more specific workspaces. Always includes `home`.
   */
  match: string[]
  /** Contextual sub-navigation shown when this workspace is active. */
  nav: WorkspaceNavItem[]
  /** One-line description (switcher tooltip + command palette). */
  description: string
  /** AI-first workspace — receives the indigo AI treatment in the switcher. */
  ai?: boolean
}

// ─── FSA portal (/app) — 21 workspaces (matrix §1) ────────────────────────────
// Every current (fsa)/layout.tsx NAV href lands in exactly one workspace below;
// the registry-covers-legacy-nav invariant test enforces that nothing is dropped.

const FSA: Workspace[] = [
  {
    id: 'executive',
    label: 'Executive',
    portal: 'fsa',
    section: 'Command',
    icon: 'Gauge',
    home: '/app',
    // '/app' is the broad fallback (shortest prefix → only wins when nothing more
    // specific matches). The explicit subtrees keep executive views on Executive.
    match: ['/app', '/app/dashboards', '/app/forecasts', '/app/executive', '/app/revenue', '/app/notifications'],
    description: 'Command overview — production, KPIs, briefing, and what needs you next.',
    nav: [
      { href: '/app', label: 'Overview', icon: 'LayoutDashboard', exact: true },
      { href: '/app/executive/briefing', label: 'Daily Briefing', icon: 'Newspaper' },
      { href: '/app/executive/kpis', label: 'KPIs', icon: 'Gauge' },
      { href: '/app/executive/production', label: 'Production', icon: 'TrendingUp' },
      { href: '/app/executive/performance', label: 'Performance', icon: 'BarChart3' },
      { href: '/app/executive/conversion', label: 'Conversion', icon: 'Repeat' },
      { href: '/app/executive/cross-sell', label: 'Cross-Sell Signal', icon: 'Shuffle' },
      { href: '/app/executive/alerts', label: 'Alerts', icon: 'AlertTriangle' },
      { href: '/app/dashboards', label: 'Dashboards', icon: 'LayoutGrid' },
      { href: '/app/forecasts', label: 'Forecasts', icon: 'TrendingUp' },
      { href: '/app/revenue', label: 'Revenue Center', icon: 'Wallet' },
      { href: '/app/notifications', label: 'Notifications', icon: 'Bell' },
    ],
  },
  {
    id: 'ai-workforce',
    label: 'AI Workforce',
    portal: 'fsa',
    section: 'Command',
    icon: 'Bot',
    home: '/app/ai/workforce',
    match: ['/app/ai', '/app/assistant'],
    ai: true,
    description: 'Your autonomous agents — runs, escalations, evaluations, and the assistant.',
    nav: [
      { href: '/app/ai/workforce', label: 'Workforce', icon: 'Gauge' },
      { href: '/app/ai', label: 'AI Operations', icon: 'Bot' },
      { href: '/app/ai/agents', label: 'Agents', icon: 'Bot' },
      { href: '/app/ai/runs', label: 'Runs', icon: 'ScrollText' },
      { href: '/app/ai/escalations', label: 'Escalations', icon: 'AlertTriangle' },
      { href: '/app/ai/evaluations', label: 'Evaluations', icon: 'ClipboardCheck' },
      { href: '/app/ai/errors', label: 'Errors', icon: 'AlertTriangle' },
      { href: '/app/assistant', label: 'Assistant', icon: 'Sparkles' },
    ],
  },
  {
    id: 'fna',
    label: 'Financial Planning',
    portal: 'fsa',
    section: 'Command',
    icon: 'FileSignature',
    home: '/app/fna',
    match: ['/app/fna'],
    ai: true,
    description: 'The AI FNA command center — plans, needs analysis, scenarios, and reports.',
    nav: [
      { href: '/app/fna', label: 'Overview', icon: 'LayoutDashboard', exact: true },
      { href: '/app/fna/plans', label: 'Plans', icon: 'FileSignature' },
      { href: '/app/fna/generate', label: 'Generate FNA', icon: 'Sparkles' },
      { href: '/app/fna/cash-flow', label: 'Cash Flow', icon: 'Wallet' },
      { href: '/app/fna/net-worth', label: 'Net Worth', icon: 'BarChart3' },
      { href: '/app/fna/protection', label: 'Protection', icon: 'ShieldCheck' },
      { href: '/app/fna/retirement', label: 'Retirement', icon: 'TrendingUp' },
      { href: '/app/fna/goals', label: 'Goals', icon: 'Target' },
      { href: '/app/fna/assumptions', label: 'Assumptions', icon: 'ClipboardList' },
      { href: '/app/fna/reports', label: 'Reports', icon: 'FolderOpen' },
    ],
  },
  {
    id: 'communications',
    label: 'Communications',
    portal: 'fsa',
    section: 'Command',
    icon: 'Radio',
    home: '/app/comms',
    // '/app/comms/inbox' is a longer prefix owned by the Inbox workspace, so it
    // wins for inbox routes even though '/app/comms' matches here too.
    match: ['/app/comms'],
    ai: true,
    description: 'Campaigns, sequences, templates, and delivery across SMS and email.',
    nav: [
      { href: '/app/comms', label: 'Overview', icon: 'LayoutDashboard', exact: true },
      { href: '/app/comms/campaigns', label: 'Campaigns', icon: 'Radio' },
      // Native campaign engines (D12): make the three multi-channel engines discoverable from the
      // primary sidebar, not only the in-page CommsSubnav. Routes already live under the
      // Communications workspace (/app/comms/*), so these are its sub-pages.
      { href: '/app/comms/life-conversion', label: 'Life Conversion', icon: 'CalendarClock' },
      { href: '/app/comms/cross-sell-life', label: 'Cross-Sell Life', icon: 'Shuffle' },
      { href: '/app/comms/pipeline-winback', label: 'Win-Back', icon: 'Repeat' },
      { href: '/app/comms/district-nurture', label: 'Second Conversation', icon: 'GraduationCap' },
      { href: '/app/comms/sequences', label: 'Sequences', icon: 'Workflow' },
      { href: '/app/comms/templates', label: 'Templates', icon: 'ClipboardList' },
      { href: '/app/comms/library', label: 'Library', icon: 'BookOpen' },
      { href: '/app/comms/audience', label: 'Audience', icon: 'Users' },
      { href: '/app/comms/sms', label: 'SMS', icon: 'MessageSquare' },
      { href: '/app/comms/email', label: 'Email', icon: 'FileText' },
      { href: '/app/comms/delivery', label: 'Delivery', icon: 'TrendingUp' },
      { href: '/app/comms/analytics', label: 'Analytics', icon: 'BarChart3' },
      { href: '/app/comms/suppression', label: 'Suppression', icon: 'ShieldCheck' },
      { href: '/app/comms/identity', label: 'Sender Identity', icon: 'Contact' },
    ],
  },
  {
    id: 'inbox',
    label: 'Inbox',
    portal: 'fsa',
    section: 'Command',
    icon: 'MessageSquare',
    home: '/app/comms/inbox',
    match: ['/app/comms/inbox'],
    description: 'Two-way conversations with clients and agency owners.',
    nav: [{ href: '/app/comms/inbox', label: 'Conversations', icon: 'MessageSquare' }],
  },
  {
    id: 'social',
    label: 'Social',
    portal: 'fsa',
    section: 'Command',
    icon: 'Share2',
    home: '/app/social',
    match: ['/app/social'],
    ai: true,
    description: 'Plan, queue, and measure social content across connected accounts.',
    nav: [
      { href: '/app/social', label: 'Overview', icon: 'LayoutDashboard', exact: true },
      { href: '/app/social/content', label: 'Content', icon: 'FileText' },
      { href: '/app/social/calendar', label: 'Calendar', icon: 'Calendar' },
      { href: '/app/social/queue', label: 'Queue', icon: 'ClipboardList' },
      { href: '/app/social/accounts', label: 'Accounts', icon: 'Contact' },
      { href: '/app/social/engagement', label: 'Engagement', icon: 'MessageSquare' },
      { href: '/app/social/analytics', label: 'Analytics', icon: 'BarChart3' },
      { href: '/app/social/attribution', label: 'Attribution', icon: 'Target' },
      { href: '/app/social/health', label: 'Health', icon: 'ShieldCheck' },
    ],
  },
  {
    id: 'cross-sell',
    label: 'Cross-Sell',
    portal: 'fsa',
    section: 'Pipeline',
    icon: 'Shuffle',
    home: '/app/cross-sell',
    match: ['/app/cross-sell', '/app/crosssell'],
    description: 'Household coverage gaps and agency penetration opportunities.',
    nav: [
      { href: '/app/cross-sell', label: 'Overview', icon: 'LayoutDashboard', exact: true },
      { href: '/app/cross-sell/household-gaps', label: 'Household Gaps', icon: 'Users' },
      { href: '/app/cross-sell/agency-penetration', label: 'Agency Penetration', icon: 'Building2' },
      { href: '/app/cross-sell/analytics', label: 'Analytics', icon: 'BarChart3' },
      { href: '/app/crosssell', label: 'Import', icon: 'FileUp' },
    ],
  },
  {
    id: 'winback',
    // Relabeled (D12) to resolve the sidebar name collision with the native Win-Back CAMPAIGN
    // ENGINE (/app/comms/pipeline-winback). This workspace is the IMPORTED lapsed-life book
    // (contacts source=win_back, ADR-031), a distinct population from the internal-pipeline engine.
    label: 'Lapsed-Life Book (Imported)',
    portal: 'fsa',
    section: 'Pipeline',
    icon: 'RotateCcw',
    home: '/app/winback',
    match: ['/app/winback'],
    description: 'Re-engage lapsed and surrendered life policies (imported book).',
    nav: [
      { href: '/app/winback', label: 'Overview', icon: 'LayoutDashboard', exact: true },
      { href: '/app/winback/import', label: 'Import', icon: 'FileUp' },
    ],
  },
  {
    id: 'conversions',
    // Relabeled (D12) to resolve the sidebar name collision with the native Life Conversion
    // CAMPAIGN ENGINE (/app/comms/life-conversion). This workspace is the term-conversion
    // origination surface (policy-window detection / eligible book), distinct from the engine.
    label: 'Conversion Windows',
    portal: 'fsa',
    section: 'Pipeline',
    icon: 'Repeat',
    home: '/app/conversions',
    match: ['/app/conversions'],
    description: 'Term-conversion eligibility windows and monitoring.',
    nav: [
      { href: '/app/conversions', label: 'Overview', icon: 'LayoutDashboard', exact: true },
      { href: '/app/conversions/eligible', label: 'Eligible', icon: 'ClipboardCheck' },
      { href: '/app/conversions/timeline', label: 'Timeline', icon: 'Calendar' },
      { href: '/app/conversions/monitoring', label: 'Monitoring', icon: 'Gauge' },
      { href: '/app/conversions/analytics', label: 'Analytics', icon: 'BarChart3' },
      { href: '/app/conversions/import', label: 'Import', icon: 'FileUp' },
    ],
  },
  {
    id: 'agencies',
    label: 'Agencies',
    portal: 'fsa',
    section: 'Book',
    icon: 'Building2',
    home: '/app/agencies',
    match: ['/app/agencies'],
    description: 'Agency-owner partnerships — the aggregate root of the book.',
    nav: [
      { href: '/app/agencies', label: 'All Agencies', icon: 'Building2', exact: true },
      { href: '/app/agencies/map', label: 'Map', icon: 'Map' },
      { href: '/app/agencies/leaderboard', label: 'Leaderboard', icon: 'BarChart3' },
      { href: '/app/agencies/new', label: 'Add Agency', icon: 'UserPlus' },
      { href: '/app/agencies/import', label: 'Import', icon: 'FileUp' },
    ],
  },
  {
    id: 'referrals',
    label: 'Referrals',
    portal: 'fsa',
    section: 'Book',
    icon: 'UserPlus',
    home: '/app/referrals',
    match: ['/app/referrals'],
    description: 'Agency-sourced referrals awaiting triage and conversion.',
    nav: [
      { href: '/app/referrals', label: 'All Referrals', icon: 'UserPlus', exact: true },
      { href: '/app/referrals/analytics', label: 'Analytics', icon: 'BarChart3' },
      { href: '/app/referrals/new', label: 'Add Referral', icon: 'UserPlus' },
    ],
  },
  {
    id: 'households',
    label: 'Contacts',
    portal: 'fsa',
    section: 'Book',
    icon: 'Contact',
    home: '/app/households',
    // Canonical CRM Contacts surface (redesign §1). Owns both the household
    // aggregate and the legacy /app/contacts sub-surfaces (segments, review,
    // detail) so their sidebar resolves to this one unified workspace; the bare
    // /app/contacts list redirects here.
    match: ['/app/households', '/app/contacts'],
    description: 'Contacts across the book — households, members, segments, and leads.',
    nav: [
      { href: '/app/households', label: 'All Contacts', icon: 'Contact', exact: true },
      { href: '/app/contacts', label: 'Contact Center', icon: 'Contact' },
      { href: '/app/contacts/segments', label: 'Segments', icon: 'Users' },
      { href: '/app/uploads', label: 'Upload Center', icon: 'Upload' },
      { href: '/app/contacts/review', label: 'Import Review', icon: 'ClipboardCheck' },
      { href: '/app/directory', label: 'FFS Directory', icon: 'PhoneCall' },
      { href: '/app/households/new', label: 'Add Household', icon: 'UserPlus' },
    ],
  },
  {
    id: 'policies',
    label: 'Policies',
    portal: 'fsa',
    section: 'Book',
    icon: 'FileText',
    home: '/app/policies',
    match: ['/app/policies'],
    description: 'In-force policies, coverages, and lapse risk.',
    nav: [
      { href: '/app/policies', label: 'All Policies', icon: 'FileText', exact: true },
      { href: '/app/policies/lapse-risk', label: 'Lapse Risk', icon: 'AlertTriangle' },
      { href: '/app/policies/new', label: 'Add Policy', icon: 'FileText' },
    ],
  },
  {
    id: 'book-imports',
    label: 'Book Data',
    portal: 'fsa',
    section: 'Book',
    icon: 'Database',
    home: '/app/book/import',
    match: ['/app/book'],
    description: 'District book onboarding and data imports.',
    nav: [{ href: '/app/book/import', label: 'District Book Import', icon: 'Database' }],
  },
  {
    id: 'reviews',
    label: 'Reviews',
    portal: 'fsa',
    section: 'Pipeline',
    icon: 'ClipboardCheck',
    home: '/app/reviews',
    match: ['/app/reviews'],
    description: 'Financial reviews — where opportunities originate.',
    nav: [
      { href: '/app/reviews', label: 'All Reviews', icon: 'ClipboardCheck', exact: true },
      { href: '/app/reviews/due', label: 'Due', icon: 'CalendarClock' },
      { href: '/app/reviews/board', label: 'Board', icon: 'LayoutGrid' },
      { href: '/app/reviews/calendar', label: 'Calendar', icon: 'Calendar' },
      { href: '/app/reviews/types', label: 'Types', icon: 'ClipboardList' },
      { href: '/app/reviews/new', label: 'New Review', icon: 'ClipboardCheck' },
    ],
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    portal: 'fsa',
    section: 'Pipeline',
    icon: 'Target',
    home: '/app/opportunities',
    match: ['/app/opportunities', '/app/opra'],
    description: 'The pipeline — opportunities and OPRA transfers.',
    nav: [
      { href: '/app/opportunities', label: 'All Opportunities', icon: 'Target', exact: true },
      { href: '/app/opportunities/board', label: 'Board', icon: 'LayoutGrid' },
      { href: '/app/opportunities/new', label: 'New Opportunity', icon: 'Target' },
      { href: '/app/opra', label: 'OPRA Transfers', icon: 'ArrowLeftRight' },
      { href: '/app/opra/eligible', label: 'OPRA Eligible', icon: 'ClipboardCheck' },
    ],
  },
  {
    id: 'cases',
    label: 'Cases',
    portal: 'fsa',
    section: 'Pipeline',
    icon: 'Briefcase',
    home: '/app/cases',
    match: ['/app/cases'],
    description: 'Case management — submission, requirements, and service.',
    nav: [
      { href: '/app/cases', label: 'All Cases', icon: 'Briefcase', exact: true },
      { href: '/app/cases/board', label: 'Board', icon: 'LayoutGrid' },
      { href: '/app/cases/requirements', label: 'Requirements', icon: 'ClipboardList' },
      { href: '/app/cases/service-requests', label: 'Service Requests', icon: 'LifeBuoy' },
      { href: '/app/cases/new', label: 'New Case', icon: 'Briefcase' },
    ],
  },
  {
    id: 'commissions',
    label: 'Commissions',
    portal: 'fsa',
    section: 'Pipeline',
    icon: 'DollarSign',
    home: '/app/commissions',
    match: ['/app/commissions'],
    description: 'Expected vs. received commissions, splits, and reconciliation.',
    nav: [
      { href: '/app/commissions', label: 'Overview', icon: 'LayoutDashboard', exact: true },
      { href: '/app/commissions/expected', label: 'Expected', icon: 'ClipboardList' },
      { href: '/app/commissions/received', label: 'Received', icon: 'Wallet' },
      { href: '/app/commissions/pending', label: 'Pending', icon: 'CalendarClock' },
      { href: '/app/commissions/splits', label: 'Splits', icon: 'Shuffle' },
      { href: '/app/commissions/statements', label: 'Statements', icon: 'FileText' },
      { href: '/app/commissions/reconciliation', label: 'Reconciliation', icon: 'ClipboardCheck' },
      { href: '/app/commissions/discrepancies', label: 'Discrepancies', icon: 'AlertTriangle' },
      { href: '/app/commissions/gdc', label: 'GDC Tiers', icon: 'BarChart3' },
    ],
  },
  {
    id: 'workspace-tools',
    label: 'Workspace',
    portal: 'fsa',
    section: 'Operate',
    icon: 'CheckSquare',
    home: '/app/tasks',
    match: [
      '/app/tasks',
      '/app/calendar',
      '/app/booking',
      '/app/workflows',
      '/app/documents',
      '/app/forms',
      '/app/workshops',
      '/app/knowledge',
      '/app/tools',
      '/app/reports',
      '/app/search',
    ],
    description: 'Daily tools — tasks, calendar, documents, workflows, and reports.',
    nav: [
      { href: '/app/tasks', label: 'Tasks', icon: 'CheckSquare' },
      { href: '/app/calendar', label: 'Calendar', icon: 'Calendar' },
      { href: '/app/booking', label: 'Booking', icon: 'CalendarClock' },
      { href: '/app/workflows', label: 'Workflows', icon: 'Workflow' },
      { href: '/app/documents', label: 'Documents', icon: 'FolderOpen' },
      { href: '/app/forms', label: 'Client Forms', icon: 'ClipboardList' },
      { href: '/app/workshops', label: 'Workshops', icon: 'GraduationCap' },
      { href: '/app/knowledge', label: 'Knowledge Library', icon: 'BookOpen' },
      { href: '/app/tools/calculator', label: 'Sales Calculator', icon: 'Calculator' },
      { href: '/app/reports', label: 'Reports', icon: 'BarChart3' },
    ],
  },
  {
    id: 'compliance-fsa',
    label: 'Compliance',
    portal: 'fsa',
    section: 'Operate',
    icon: 'ShieldCheck',
    home: '/app/compliance',
    match: ['/app/compliance', '/app/settings', '/app/help'],
    description: 'Consent, DNC, the securities firewall, licenses, and Compliance Intelligence.',
    nav: [
      { href: '/app/compliance', label: 'Overview', icon: 'ShieldCheck', exact: true },
      { href: '/app/compliance/intelligence', label: 'Compliance Intelligence', icon: 'ScanSearch' },
      { href: '/app/compliance/consent', label: 'Consent', icon: 'ClipboardCheck' },
      { href: '/app/compliance/dnc', label: 'DNC', icon: 'ShieldCheck' },
      { href: '/app/compliance/firewall', label: 'Securities Firewall', icon: 'ShieldCheck' },
      { href: '/app/compliance/licenses', label: 'Licenses', icon: 'ClipboardList' },
      { href: '/app/settings', label: 'Settings', icon: 'Settings' },
      { href: '/app/help', label: 'Help & Support', icon: 'LifeBuoy' },
    ],
  },
]

// ─── Admin portal (/admin) — matrix §2 ────────────────────────────────────────
const ADMIN: Workspace[] = [
  {
    id: 'admin-home', label: 'Back Office', portal: 'admin', section: 'Admin', icon: 'LayoutDashboard',
    home: '/admin', match: ['/admin'], description: 'Back-office overview.',
    nav: [{ href: '/admin', label: 'Overview', icon: 'LayoutDashboard', exact: true }],
  },
  {
    id: 'admin-users', label: 'Users & Access', portal: 'admin', section: 'Admin', icon: 'Users',
    home: '/admin/users', match: ['/admin/users'], description: 'Users and access.',
    nav: [{ href: '/admin/users', label: 'Users', icon: 'Users' }],
  },
  {
    id: 'admin-cases', label: 'Cases', portal: 'admin', section: 'Admin', icon: 'Briefcase',
    home: '/admin/cases', match: ['/admin/cases'], description: 'Back-office case queue.',
    nav: [{ href: '/admin/cases', label: 'Cases', icon: 'Briefcase' }],
  },
  {
    id: 'admin-documents', label: 'Documents', portal: 'admin', section: 'Admin', icon: 'FolderOpen',
    home: '/admin/documents', match: ['/admin/documents'], description: 'Document verification.',
    nav: [
      { href: '/admin/documents', label: 'Documents', icon: 'FolderOpen', exact: true },
      { href: '/admin/documents/verify', label: 'Verify', icon: 'ClipboardCheck' },
    ],
  },
  {
    id: 'admin-data', label: 'Data Ops', portal: 'admin', section: 'Admin', icon: 'Database',
    home: '/admin/data/imports', match: ['/admin/data'], description: 'Imports, exports, duplicates.',
    nav: [
      { href: '/admin/data/imports', label: 'Imports', icon: 'FileUp' },
      { href: '/admin/data/exports', label: 'Exports', icon: 'FolderOpen' },
      { href: '/admin/data/duplicates', label: 'Duplicates', icon: 'ClipboardCheck' },
    ],
  },
  {
    id: 'admin-support', label: 'Support', portal: 'admin', section: 'Admin', icon: 'LifeBuoy',
    home: '/admin/support/requests', match: ['/admin/support'], description: 'Support requests.',
    nav: [{ href: '/admin/support/requests', label: 'Requests', icon: 'LifeBuoy' }],
  },
  {
    id: 'admin-config', label: 'Config', portal: 'admin', section: 'Admin', icon: 'Settings',
    home: '/admin/config/general', match: ['/admin/config'], description: 'Back-office configuration.',
    nav: [{ href: '/admin/config/general', label: 'Configuration', icon: 'Settings' }],
  },
]

// ─── Compliance portal (/compliance) — matrix §3 ──────────────────────────────
const COMPLIANCE: Workspace[] = [
  {
    id: 'comp-home', label: 'Compliance', portal: 'compliance', section: 'Supervision', icon: 'ShieldCheck',
    home: '/compliance', match: ['/compliance'], description: 'Supervisory overview.',
    nav: [{ href: '/compliance', label: 'Overview', icon: 'ShieldCheck', exact: true }],
  },
  {
    id: 'comp-supervision', label: 'Supervision', portal: 'compliance', section: 'Supervision', icon: 'ScanSearch',
    home: '/compliance/communications', match: ['/compliance/communications', '/compliance/audit', '/compliance/incidents'],
    description: 'Communications review, audit, and incidents.',
    nav: [
      { href: '/compliance/communications', label: 'Communications', icon: 'MessageSquare' },
      { href: '/compliance/audit', label: 'Audit', icon: 'ScrollText' },
      { href: '/compliance/incidents', label: 'Incidents', icon: 'AlertTriangle' },
    ],
  },
  {
    id: 'comp-consent', label: 'Consent & Firewall', portal: 'compliance', section: 'Controls', icon: 'ClipboardCheck',
    home: '/compliance/consent', match: ['/compliance/consent', '/compliance/firewall'],
    description: 'Consent ledger and the securities firewall.',
    nav: [
      { href: '/compliance/consent', label: 'Consent', icon: 'ClipboardCheck' },
      { href: '/compliance/firewall', label: 'Securities Firewall', icon: 'ShieldCheck' },
    ],
  },
  {
    id: 'comp-registrations', label: 'Registrations', portal: 'compliance', section: 'Controls', icon: 'ClipboardList',
    home: '/compliance/licenses', match: ['/compliance/licenses', '/compliance/attestations', '/compliance/policies'],
    description: 'Licenses, attestations, and policies.',
    nav: [
      { href: '/compliance/licenses', label: 'Licenses', icon: 'ClipboardList' },
      { href: '/compliance/attestations', label: 'Attestations', icon: 'ClipboardCheck' },
      { href: '/compliance/policies', label: 'Policies', icon: 'FileText' },
    ],
  },
  {
    id: 'comp-holds', label: 'Legal Holds', portal: 'compliance', section: 'Controls', icon: 'Lock',
    home: '/compliance/legal-holds', match: ['/compliance/legal-holds'], description: 'Legal holds.',
    nav: [{ href: '/compliance/legal-holds', label: 'Legal Holds', icon: 'Lock' }],
  },
]

// ─── Partner portal (/partner) — matrix §4 ────────────────────────────────────
const PARTNER: Workspace[] = [
  {
    id: 'partner-home', label: 'Home', portal: 'partner', section: 'Partner', icon: 'LayoutDashboard',
    home: '/partner', match: ['/partner'], description: 'Agency-owner overview.',
    nav: [{ href: '/partner', label: 'Overview', icon: 'LayoutDashboard', exact: true }],
  },
  {
    id: 'partner-referrals', label: 'Referrals', portal: 'partner', section: 'Partner', icon: 'UserPlus',
    home: '/partner/referrals', match: ['/partner/referrals', '/partner/refer'],
    description: 'Refer clients and track their progress.',
    nav: [
      { href: '/partner/referrals', label: 'My Referrals', icon: 'UserPlus' },
      { href: '/partner/refer', label: 'Refer a Client', icon: 'UserPlus' },
    ],
  },
  {
    id: 'partner-production', label: 'Production', portal: 'partner', section: 'Partner', icon: 'TrendingUp',
    home: '/partner/production', match: ['/partner/production', '/partner/commissions'],
    description: 'Production and commissions.',
    nav: [
      { href: '/partner/production', label: 'Production', icon: 'TrendingUp' },
      { href: '/partner/commissions', label: 'Commissions', icon: 'DollarSign' },
    ],
  },
  {
    id: 'partner-engage', label: 'Engagement', portal: 'partner', section: 'Partner', icon: 'MessageSquare',
    home: '/partner/messages', match: ['/partner/messages', '/partner/schedule', '/partner/tasks'],
    description: 'Messages, scheduling, and tasks.',
    nav: [
      { href: '/partner/messages', label: 'Messages', icon: 'MessageSquare' },
      { href: '/partner/schedule', label: 'Schedule', icon: 'Calendar' },
      { href: '/partner/tasks', label: 'Tasks', icon: 'CheckSquare' },
    ],
  },
  {
    id: 'partner-resources', label: 'Resources', portal: 'partner', section: 'Partner', icon: 'FolderOpen',
    home: '/partner/materials', match: ['/partner/materials', '/partner/training'],
    description: 'Materials and training.',
    nav: [
      { href: '/partner/materials', label: 'Materials', icon: 'FolderOpen' },
      { href: '/partner/training', label: 'Training', icon: 'GraduationCap' },
    ],
  },
  {
    id: 'partner-settings', label: 'Settings', portal: 'partner', section: 'Partner', icon: 'Settings',
    home: '/partner/settings', match: ['/partner/settings'], description: 'Account settings.',
    nav: [{ href: '/partner/settings', label: 'Settings', icon: 'Settings' }],
  },
]

// ─── Client portal (/client) — matrix §5 ──────────────────────────────────────
const CLIENT: Workspace[] = [
  {
    id: 'client-home', label: 'Home', portal: 'client', section: 'Client', icon: 'LayoutDashboard',
    home: '/client', match: ['/client'], description: 'Your overview.',
    nav: [{ href: '/client', label: 'Overview', icon: 'LayoutDashboard', exact: true }],
  },
  {
    id: 'client-case', label: 'My Case', portal: 'client', section: 'Client', icon: 'Briefcase',
    home: '/client/case-status', match: ['/client/case-status', '/client/documents', '/client/intake'],
    description: 'Case status, intake, and documents.',
    nav: [
      { href: '/client/case-status', label: 'Case Status', icon: 'Briefcase' },
      { href: '/client/intake', label: 'Intake', icon: 'ClipboardList' },
      { href: '/client/documents', label: 'Documents', icon: 'FolderOpen' },
    ],
  },
  {
    id: 'client-appointments', label: 'Appointments', portal: 'client', section: 'Client', icon: 'Calendar',
    home: '/client/appointments', match: ['/client/appointments', '/client/schedule', '/client/reviews'],
    description: 'Appointments, scheduling, and reviews.',
    nav: [
      { href: '/client/appointments', label: 'Appointments', icon: 'Calendar' },
      { href: '/client/schedule', label: 'Schedule', icon: 'CalendarClock' },
      { href: '/client/reviews', label: 'Reviews', icon: 'ClipboardCheck' },
    ],
  },
  {
    id: 'client-education', label: 'Education', portal: 'client', section: 'Client', icon: 'BookOpen',
    home: '/client/education', match: ['/client/education'], description: 'Educational resources.',
    nav: [{ href: '/client/education', label: 'Education', icon: 'BookOpen' }],
  },
  {
    id: 'client-profile', label: 'My Profile', portal: 'client', section: 'Client', icon: 'Contact',
    home: '/client/profile', match: ['/client/profile', '/client/preferences', '/client/consent'],
    description: 'Profile, preferences, and consent.',
    nav: [
      { href: '/client/profile', label: 'Profile', icon: 'Contact' },
      { href: '/client/preferences', label: 'Preferences', icon: 'Settings' },
      { href: '/client/consent', label: 'Consent', icon: 'ClipboardCheck' },
    ],
  },
]

// ─── Super Admin portal (/super) — matrix §6 ──────────────────────────────────
const SUPER: Workspace[] = [
  {
    id: 'super-home', label: 'Platform', portal: 'super', section: 'Platform', icon: 'LayoutDashboard',
    home: '/super', match: ['/super'], description: 'Platform overview.',
    nav: [{ href: '/super', label: 'Overview', icon: 'LayoutDashboard', exact: true }],
  },
  {
    id: 'super-ai', label: 'AI Governance', portal: 'super', section: 'Platform', icon: 'Bot',
    home: '/super/ai/policies', match: ['/super/ai'], ai: true, description: 'AI policies, hours, and targets.',
    nav: [
      { href: '/super/ai/policies', label: 'Policies', icon: 'ShieldCheck' },
      { href: '/super/ai/hours', label: 'Hours', icon: 'CalendarClock' },
      { href: '/super/ai/targets', label: 'Targets', icon: 'Target' },
      { href: '/super/ai/sandbox', label: 'Sandbox', icon: 'Sparkles' },
    ],
  },
  {
    id: 'super-users', label: 'Users & Roles', portal: 'super', section: 'Platform', icon: 'Users',
    home: '/super/users', match: ['/super/users', '/super/roles', '/super/permissions'],
    description: 'Users, roles, and permissions.',
    nav: [
      { href: '/super/users', label: 'Users', icon: 'Users' },
      { href: '/super/roles', label: 'Roles', icon: 'ShieldCheck' },
      { href: '/super/permissions', label: 'Permissions', icon: 'Lock' },
    ],
  },
  {
    id: 'super-products', label: 'Products & Config', portal: 'super', section: 'Platform', icon: 'Package',
    home: '/super/products', match: ['/super/products', '/super/product-config', '/super/config', '/super/states'],
    description: 'Products, config defaults, and states.',
    nav: [
      { href: '/super/products', label: 'Products', icon: 'Package' },
      { href: '/super/product-config', label: 'Product Config', icon: 'Settings' },
      { href: '/super/config/gdc-tiers', label: 'GDC Tiers', icon: 'BarChart3' },
      { href: '/super/config/ffs-contacts', label: 'FFS Contacts', icon: 'PhoneCall' },
      { href: '/super/states', label: 'States', icon: 'Map' },
    ],
  },
  {
    id: 'super-ops', label: 'Platform Ops', portal: 'super', section: 'Operations', icon: 'Server',
    home: '/super/health', match: ['/super/health', '/super/jobs', '/super/backups', '/super/webhooks', '/super/workflows'],
    description: 'Health, jobs, backups, and webhooks.',
    nav: [
      { href: '/super/health', label: 'Health', icon: 'Gauge' },
      { href: '/super/jobs', label: 'Jobs', icon: 'Workflow' },
      { href: '/super/backups', label: 'Backups', icon: 'Database' },
      { href: '/super/webhooks', label: 'Webhooks', icon: 'Plug' },
      { href: '/super/workflows', label: 'Workflows', icon: 'Workflow' },
    ],
  },
  {
    id: 'super-integrations', label: 'Integrations', portal: 'super', section: 'Operations', icon: 'Plug',
    home: '/super/integrations', match: ['/super/integrations'], description: 'Third-party integrations.',
    nav: [{ href: '/super/integrations', label: 'Integrations', icon: 'Plug' }],
  },
  {
    id: 'super-security', label: 'Security & Audit', portal: 'super', section: 'Operations', icon: 'Lock',
    home: '/super/security', match: ['/super/security', '/super/audit'], description: 'Security posture and audit log.',
    nav: [
      { href: '/super/security', label: 'Security', icon: 'Lock' },
      { href: '/super/audit', label: 'Audit Log', icon: 'ScrollText' },
    ],
  },
]

/** The complete registry, in portal order. */
export const WORKSPACES: Workspace[] = [...FSA, ...ADMIN, ...COMPLIANCE, ...PARTNER, ...CLIENT, ...SUPER]

// ─── Pure helpers (import-free) ───────────────────────────────────────────────

/** Portal home route — the back-nav target for every workspace in that portal. */
export const PORTAL_HOME: Record<WorkspacePortal, string> = {
  fsa: '/app',
  admin: '/admin',
  compliance: '/compliance',
  partner: '/partner',
  client: '/client',
  super: '/super',
}

/** Workspaces belonging to a portal, in registry order. */
export function portalWorkspaces(portal: WorkspacePortal): Workspace[] {
  return WORKSPACES.filter((w) => w.portal === portal)
}

/** Workspaces grouped by their switcher section, preserving first-seen order. */
export function workspaceSections(portal: WorkspacePortal): { section: string; items: Workspace[] }[] {
  const order: string[] = []
  const map = new Map<string, Workspace[]>()
  for (const w of portalWorkspaces(portal)) {
    if (!map.has(w.section)) {
      map.set(w.section, [])
      order.push(w.section)
    }
    map.get(w.section)!.push(w)
  }
  return order.map((section) => ({ section, items: map.get(section)! }))
}

function matchLen(prefixes: string[], pathname: string): number {
  let best = -1
  for (const p of prefixes) {
    if (pathname === p || pathname.startsWith(p + '/')) best = Math.max(best, p.length)
  }
  return best
}

/**
 * The workspace that owns a pathname within a portal: the one whose matching
 * prefix is longest (so a broad fallback like '/app' yields to a specific
 * workspace). Returns the portal's first workspace if nothing matches.
 */
export function activeWorkspace(portal: WorkspacePortal, pathname: string): Workspace | undefined {
  const list = portalWorkspaces(portal)
  let winner: Workspace | undefined
  let winnerLen = -1
  for (const w of list) {
    const len = matchLen(w.match, pathname)
    if (len > winnerLen) {
      winnerLen = len
      winner = w
    }
  }
  return winner ?? list[0]
}

/** The active sub-nav href within a workspace (longest prefix / exact match). */
export function activeNavHref(ws: Workspace, pathname: string): string | undefined {
  let best: string | undefined
  let bestLen = -1
  for (const item of ws.nav) {
    const hit = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/')
    if (hit && item.href.length > bestLen) {
      bestLen = item.href.length
      best = item.href
    }
  }
  return best
}
