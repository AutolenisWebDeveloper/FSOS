// src/lib/workspaces/icons.tsx
// Resolves the Workspace Registry's string icon names to lucide components. Kept
// OUT of registry.ts so that module stays import-free and single-file testable
// (tests/workspace-registry.test.mjs). Also the build-time drift guard that keeps
// WorkspacePortal ⊆ rbac.Portal.

import type { LucideIcon } from 'lucide-react'
import {
  Gauge, Bot, FileSignature, Radio, MessageSquare, Share2, LayoutDashboard, Newspaper,
  TrendingUp, BarChart3, Repeat, Shuffle, AlertTriangle, LayoutGrid, Wallet, Bell, Sparkles,
  ScrollText, ClipboardCheck, Users, FileText, ClipboardList, BookOpen, Contact, RotateCcw,
  FileUp, Calendar, Building2, Map, UserPlus, PhoneCall, Upload, Database, Target, ArrowLeftRight,
  Briefcase, DollarSign, CalendarClock, Workflow, FolderOpen, GraduationCap, Calculator, ShieldCheck,
  ScanSearch, Settings, LifeBuoy, CheckSquare, Lock, Package, Server, Plug, Circle,
} from 'lucide-react'
import type { Portal } from '@/lib/auth/rbac'
import type { WorkspacePortal } from './registry'

// Build-time drift guard: if WorkspacePortal ever diverges from rbac.Portal, this
// assignment stops compiling — so the registry's declared portals can never name a
// portal the authorization layer does not know about.
export const assertPortal = (p: WorkspacePortal): Portal => p

const MAP: Record<string, LucideIcon> = {
  Gauge, Bot, FileSignature, Radio, MessageSquare, Share2, LayoutDashboard, Newspaper,
  TrendingUp, BarChart3, Repeat, Shuffle, AlertTriangle, LayoutGrid, Wallet, Bell, Sparkles,
  ScrollText, ClipboardCheck, Users, FileText, ClipboardList, BookOpen, Contact, RotateCcw,
  FileUp, Calendar, Building2, Map, UserPlus, PhoneCall, Upload, Database, Target, ArrowLeftRight,
  Briefcase, DollarSign, CalendarClock, Workflow, FolderOpen, GraduationCap, Calculator, ShieldCheck,
  ScanSearch, Settings, LifeBuoy, CheckSquare, Lock, Package, Server, Plug,
}

/** Resolve a registry icon name to a lucide component (falls back to a dot). */
export function resolveIcon(name: string): LucideIcon {
  return MAP[name] ?? Circle
}
