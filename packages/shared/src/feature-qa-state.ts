import { featureQaStateSchema } from './schemas';
import type { FeatureQaState } from './types';

/**
 * Heading marker used to locate the QA state section in a PRD body.
 * The section should contain a fenced JSON block with the QA contract.
 */
export const QA_STATE_SECTION_HEADING = '## QA State';

/**
 * Extract a FeatureQaState from a PRD body if a `## QA State` section
 * with a valid fenced JSON block exists. Returns null + reason when
 * the section is absent or malformed.
 */
export function extractFeatureQaState(body: string): {
  qaState: FeatureQaState | null;
  /** Absent = no section, invalid = section found but JSON malformed. */
  status: 'present' | 'absent' | 'invalid';
  /** Human-readable reason when status != present. */
  reason?: string;
} {
  const headingIdx = findSectionIndex(body, QA_STATE_SECTION_HEADING);
  if (headingIdx === -1) {
    return { qaState: null, status: 'absent', reason: 'No ## QA State section found in PRD.' };
  }

  const sectionBody = extractSectionBody(body, headingIdx);
  const jsonBlock = extractJsonFromFence(sectionBody);

  if (!jsonBlock) {
    return {
      qaState: null,
      status: 'invalid',
      reason:
        '## QA State section found but contains no valid fenced JSON block (use ```json ... ```).',
    };
  }

  try {
    const parsed = JSON.parse(jsonBlock) as unknown;
    const result = featureQaStateSchema.safeParse(parsed);
    if (result.success) {
      return { qaState: result.data as FeatureQaState, status: 'present' };
    }
    return {
      qaState: null,
      status: 'invalid',
      reason: `## QA State JSON failed validation: ${result.error.issues.map((i) => i.message).join('; ')}`,
    };
  } catch (err) {
    return {
      qaState: null,
      status: 'invalid',
      reason: `## QA State contains malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build an actionable message when QA state is missing or invalid.
 * This gets surfaced to the planner/verifier so they know the gap.
 */
export function buildQaStateGapMessage(
  status: 'absent' | 'invalid',
  reason: string,
  issueNumber?: number | null,
): string {
  const target = issueNumber ? ` for issue #${issueNumber}` : '';
  if (status === 'absent') {
    return (
      `[QA gap${target}] No feature-scoped QA state declared. ` +
      'Add a ## QA State section with a ```json block to enable focused QA verification. ' +
      'Without it, the verifier cannot scope tests to this feature.'
    );
  }
  return `[QA gap${target}] ${reason}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function findSectionIndex(body: string, heading: string): number {
  const lower = body.toLowerCase();
  const target = heading.toLowerCase();
  let idx = lower.indexOf(target);
  while (idx !== -1) {
    // Must be at start of line (or start of string)
    if (idx === 0 || body[idx - 1] === '\n') return idx;
    idx = lower.indexOf(target, idx + 1);
  }
  return -1;
}

function extractSectionBody(body: string, headingStart: number): string {
  // Skip the heading line itself
  const afterHeading = body.indexOf('\n', headingStart);
  if (afterHeading === -1) return '';
  const rest = body.slice(afterHeading + 1);

  // Find next ## heading (end of section)
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function extractJsonFromFence(section: string): string | null {
  const fencePattern = /```(?:json)?\s*\n([\s\S]*?)```/;
  const match = section.match(fencePattern);
  return match?.[1]?.trim() ?? null;
}
