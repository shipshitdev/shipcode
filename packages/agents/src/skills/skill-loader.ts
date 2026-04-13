import { type BundledDefault, DEFAULT_SKILLS, type PhaseSkillKey } from './defaults.generated';

export interface SkillSlot {
  key: string;
  value: string;
}

export interface ResolvedSkill {
  /** Where the content came from in the resolution chain. */
  source: 'project' | 'global' | 'default';
  /** Project ID when source === 'project', otherwise null. */
  projectId: string | null;
  /** Markdown body with YAML frontmatter stripped — what gets sent to the provider after interpolation. */
  content: string;
  /** sha256 of the bundled default at the time the override was forked (or current bundled when source === 'default'). */
  baseVersion: string;
}

export interface SkillValidationError {
  code: 'missing_slot' | 'no_frontmatter' | 'schema_drift';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Persistence interface the loader needs. Implemented by `@shipcode/db`'s
 * `SkillsQueries`. We model it as a structural interface here so the agents
 * package does not need to import @shipcode/db.
 */
export interface SkillsRowSource {
  get(
    projectId: string | null,
    phase: PhaseSkillKey,
  ): {
    content: string;
    baseVersion: string;
    schemaVersion: number;
    status: 'ok' | 'quarantined';
  } | null;
  markQuarantined(projectId: string | null, phase: PhaseSkillKey, reason: string): void;
}

export interface ResolveResult {
  skill: ResolvedSkill;
  /** True when at least one tier was skipped because validation failed (or row was already quarantined). */
  fallbackUsed: boolean;
  /** Populated when fallbackUsed is true; describes the first reason a tier was skipped. */
  error?: SkillValidationError;
}

/**
 * Strip YAML frontmatter from a SKILL.md content string. The frontmatter is
 * editor metadata; the LLM only sees the body. This is also what protects us
 * from the `--- argv` parsing incident — the prompt sent to the provider
 * never starts with `---`.
 */
export function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1].trimStart() : raw;
}

/**
 * Validate a skill content blob against a phase's bundled requirements.
 * Returns null when valid, a SkillValidationError when not. Called both on
 * save (to block bad writes) and on load (to skip + quarantine bad rows).
 */
export function validateSkill(phase: PhaseSkillKey, content: string): SkillValidationError | null {
  const bundled = DEFAULT_SKILLS[phase];
  if (!bundled) {
    return {
      code: 'schema_drift',
      message: `Unknown phase "${phase}"`,
    };
  }

  // Frontmatter must parse — reject anything that doesn't have the leading `---` block.
  if (!/^---\n[\s\S]*?\n---\n/.test(content)) {
    return {
      code: 'no_frontmatter',
      message: 'Skill must start with a YAML frontmatter block delimited by ---',
    };
  }

  // Every required slot from the bundled default must appear in the body.
  const body = stripFrontmatter(content);
  const missing: string[] = [];
  for (const slot of bundled.requiredSlots) {
    if (!body.includes(`{{${slot}}}`)) {
      missing.push(slot);
    }
  }
  if (missing.length > 0) {
    return {
      code: 'missing_slot',
      message: `Missing required slot${missing.length > 1 ? 's' : ''}: ${missing.map((s) => `{{${s}}}`).join(', ')}`,
      details: { missing },
    };
  }

  return null;
}

/**
 * Resolve a phase skill by walking the tier chain:
 *   1. project override
 *   2. global override
 *   3. bundled default
 *
 * For each row, validateSkill is called. If validation fails, the row is
 * marked quarantined (preserved on disk for manual recovery) and the next
 * tier is consulted. The bundled default is the last resort and is
 * guaranteed valid by the build script.
 */
export function resolveSkill(
  phase: PhaseSkillKey,
  projectId: string | null,
  deps: { skills: SkillsRowSource },
): ResolveResult {
  const bundled = DEFAULT_SKILLS[phase];
  if (!bundled) {
    throw new Error(`resolveSkill: unknown phase "${phase}"`);
  }

  let firstError: SkillValidationError | undefined;
  let fallbackUsed = false;

  const tryRow = (
    rowProjectId: string | null,
    source: 'project' | 'global',
  ): ResolvedSkill | null => {
    const row = deps.skills.get(rowProjectId, phase);
    if (!row) return null;
    if (row.status === 'quarantined') {
      fallbackUsed = true;
      if (!firstError) {
        firstError = {
          code: 'schema_drift',
          message: `Existing override at ${source} scope is quarantined`,
        };
      }
      return null;
    }
    const error = validateSkill(phase, row.content);
    if (error) {
      deps.skills.markQuarantined(rowProjectId, phase, error.message);
      fallbackUsed = true;
      if (!firstError) firstError = error;
      return null;
    }
    return {
      source,
      projectId: rowProjectId,
      content: stripFrontmatter(row.content),
      baseVersion: row.baseVersion,
    };
  };

  // Tier 1: project override (only when projectId is non-null)
  if (projectId !== null) {
    const projectResolved = tryRow(projectId, 'project');
    if (projectResolved) return { skill: projectResolved, fallbackUsed, error: firstError };
  }

  // Tier 2: global override
  const globalResolved = tryRow(null, 'global');
  if (globalResolved) return { skill: globalResolved, fallbackUsed, error: firstError };

  // Tier 3: bundled default — guaranteed valid by the build script.
  return {
    skill: {
      source: 'default',
      projectId: null,
      content: stripFrontmatter(bundled.content),
      baseVersion: bundled.version,
    },
    fallbackUsed,
    error: firstError,
  };
}

/**
 * Replace `{{KEY}}` tokens in a skill body with concrete runtime values.
 *
 * - Throws on unknown slot in dev (NODE_ENV !== 'production') so issues are
 *   caught immediately during testing.
 * - Clamps to `[unknown slot: KEY]` in production so a single bad slot does
 *   not crash a long-running pipeline.
 * - Throws on missing slot in either mode — that means the prompt builder
 *   forgot to pass a value the skill body references, which is a code bug
 *   and not user-recoverable.
 */
export function interpolateSkill(content: string, slots: SkillSlot[]): string {
  const slotMap = new Map<string, string>();
  for (const slot of slots) {
    slotMap.set(slot.key, slot.value);
  }

  const isProd = process.env.NODE_ENV === 'production';
  const referenced = new Set<string>();

  const result = content.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_, key: string) => {
    referenced.add(key);
    const slotValue = slotMap.get(key);
    if (slotValue !== undefined) {
      return slotValue;
    }
    if (isProd) {
      return `[unknown slot: ${key}]`;
    }
    throw new Error(
      `interpolateSkill: skill body references unknown slot {{${key}}} (provided slots: ${slots.map((s) => s.key).join(', ') || 'none'})`,
    );
  });

  return result;
}

export { type BundledDefault, DEFAULT_SKILLS, type PhaseSkillKey };
