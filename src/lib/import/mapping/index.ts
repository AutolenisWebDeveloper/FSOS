// src/lib/import/mapping/index.ts
// Contact Import — Field Recognition & Mapping Model (design spec v2.1).
// Barrel for the pure recognition/mapping engine. Persistence lives in store.ts.
// Explicit re-exports (not `export *`) so re-exported const values resolve
// identically under the app bundler and the tsx test runner.

export {
  TARGET_FIELDS,
  getTargetField,
  isTargetFieldId,
  squashHeader,
  tokenizeHeader,
} from './fields'
export type { FieldEntity, FieldType, MemberRole, TargetField } from './fields'

export { recognizeHeader, exactAliasCount } from './dictionary'
export type { MatchConfidence, HeaderMatch } from './dictionary'

export {
  DEFAULT_COMPOSITE_DELIMITER,
  compositeRuleFor,
  isCompositeHeader,
  splitComposite,
} from './composite'
export type { SplitRule } from './composite'

export { KNOWN_TEMPLATES, detectTemplate, signatureHash } from './templates'
export type { KnownTemplate } from './templates'

export { buildMappingPlan } from './plan'
export type { HeaderDecision, DecisionMethod, PlanEntry, MappingPlan, BuildPlanInput } from './plan'

export { buildCommitPlan, extractRowExtras, parseDobToIso } from './commit'
export type { CommitPlan, RowExtras, CustomFieldDef } from './commit'
