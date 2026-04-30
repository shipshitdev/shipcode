export const PROMPT_PHASES = ['plan', 'review', 'revision', 'verify', 'execute'] as const;

export type PromptPhase = (typeof PROMPT_PHASES)[number];

export type PromptMaterialKind =
  | 'issue_prompt'
  | 'plan_output'
  | 'review_feedback'
  | 'repo_file_context'
  | 'repo_graph_context'
  | 'testing_context'
  | 'diff_summary'
  | 'verification_output'
  | 'execution_notes';

export interface PromptMaterial {
  kind: PromptMaterialKind;
  label: string;
  content: string;
}

export interface PromptMaterialSummary {
  count: number;
  labels: string[];
  kinds: PromptMaterialKind[];
}

export interface PromptPayloadSize {
  characters: number;
  bytes: number;
  lines: number;
}

export interface PromptTelemetry {
  phase: PromptPhase;
  promptSize: PromptPayloadSize;
  selectedMaterials?: PromptMaterialSummary;
}

const MATERIAL_ORDER: PromptMaterialKind[] = [
  'issue_prompt',
  'plan_output',
  'review_feedback',
  'repo_file_context',
  'repo_graph_context',
  'testing_context',
  'diff_summary',
  'verification_output',
  'execution_notes',
];

const PHASE_POLICIES: Record<PromptPhase, ReadonlySet<PromptMaterialKind>> = {
  plan: new Set([
    'issue_prompt',
    'repo_file_context',
    'repo_graph_context',
    'testing_context',
    'execution_notes',
    'verification_output',
  ]),
  review: new Set(['issue_prompt', 'plan_output', 'review_feedback', 'testing_context']),
  revision: new Set(['issue_prompt', 'plan_output', 'review_feedback', 'testing_context']),
  verify: new Set(['plan_output', 'testing_context', 'diff_summary', 'verification_output']),
  execute: new Set(['issue_prompt', 'plan_output', 'review_feedback', 'testing_context']),
};

export function selectPromptMaterials(
  phase: PromptPhase,
  materials: readonly PromptMaterial[],
): PromptMaterial[] {
  const allowed = PHASE_POLICIES[phase];
  return materials
    .filter((material) => allowed.has(material.kind) && material.content.trim().length > 0)
    .sort((left, right) => {
      const kindDelta = MATERIAL_ORDER.indexOf(left.kind) - MATERIAL_ORDER.indexOf(right.kind);
      return kindDelta || left.label.localeCompare(right.label);
    });
}

export function renderPromptMaterials(materials: readonly PromptMaterial[]): string {
  if (materials.length === 0) return 'No extra files provided.';
  return materials
    .map((material) => {
      return `<prompt_material kind="${material.kind}" label="${escapeAttribute(material.label)}">\n${material.content.trim()}\n</prompt_material>`;
    })
    .join('\n\n');
}

export function summarizePromptMaterials(
  materials: readonly PromptMaterial[],
): PromptMaterialSummary {
  return {
    count: materials.length,
    labels: materials.map((material) => material.label),
    kinds: materials.map((material) => material.kind),
  };
}

export function measurePromptPayload(prompt: string): PromptPayloadSize {
  return {
    characters: [...prompt].length,
    bytes: Buffer.byteLength(prompt, 'utf8'),
    lines: prompt.length === 0 ? 0 : prompt.split('\n').length,
  };
}

export function buildScopedContext(
  phase: PromptPhase,
  materials: readonly PromptMaterial[] | undefined,
  fallbackContext?: string,
): { contextFiles: string; selectedMaterials?: PromptMaterialSummary } {
  const baseMaterials =
    materials ??
    (fallbackContext
      ? [{ kind: 'repo_file_context' as const, label: 'repo context', content: fallbackContext }]
      : []);
  const selected = selectPromptMaterials(phase, baseMaterials);
  return {
    contextFiles: renderPromptMaterials(selected),
    selectedMaterials: summarizePromptMaterials(selected),
  };
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
