// src/emails/_test-entry.ts — bundle entry for the determinism test (esbuild → CJS).
// Re-exports the registry + render helpers so the test can render every template offline.
export { EMAIL_TEMPLATES } from './registry'
export { renderEmailTemplate, renderSha } from './render'
