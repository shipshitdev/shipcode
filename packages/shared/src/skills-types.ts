/**
 * Canonical PhaseSkillKey type + registry.
 *
 * Source of truth lives here so that `@shipcode/agents`, `@shipcode/db`, the
 * pipeline package, and the desktop renderer all import the SAME type instead
 * of redeclaring it (which previously drifted — see session log 2026-04-11).
 *
 * The `scripts/build-skill-defaults.ts` build still validates that
 * `PHASE_SKILL_KEYS` matches the actual `skills/<phase>/SKILL.md` folders at
 * repo root, so adding or renaming a skill folder here without updating the
 * filesystem (or vice versa) will fail the build.
 */

export const PHASE_SKILL_KEYS = [
  'plan-generation',
  'adversarial-review',
  'plan-revision',
  'plan-execution',
  'plan-verification',
] as const;

export type PhaseSkillKey = (typeof PHASE_SKILL_KEYS)[number];
