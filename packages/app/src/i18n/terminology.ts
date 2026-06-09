// Canonical product terms (docs/glossary.md). Every locale must define `common:term.<key>`
// for each of these, and all UI copy must reference the term via i18next nesting
// (`$t(common:term.workspace)`) rather than re-spelling it — so a term reads identically
// everywhere within a locale. The catalog test enforces presence across locales.
export const CANONICAL_TERMS = [
  "project",
  "workspace",
  "agent",
  "daemon",
  "host",
  "provider",
  "model",
  "mode",
  "worktree",
] as const;

export type CanonicalTerm = (typeof CANONICAL_TERMS)[number];
