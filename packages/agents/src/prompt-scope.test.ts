import { describe, expect, it } from 'vitest';
import {
  measurePromptPayload,
  PROMPT_PHASES,
  type PromptMaterial,
  selectPromptMaterials,
  summarizePromptMaterials,
} from './prompt-scope';

const materials: PromptMaterial[] = [
  { kind: 'issue_prompt', label: 'issue', content: 'issue body' },
  { kind: 'plan_output', label: 'plan', content: 'approved plan' },
  { kind: 'review_feedback', label: 'review', content: 'review notes' },
  { kind: 'repo_file_context', label: 'memory', content: 'broad repo context' },
  { kind: 'repo_graph_context', label: 'graph', content: 'graph stats' },
  { kind: 'testing_context', label: 'tests', content: 'bun test' },
  { kind: 'diff_summary', label: 'diff', content: 'diff --git' },
  { kind: 'verification_output', label: 'verify', content: 'failed output' },
  { kind: 'execution_notes', label: 'exec', content: 'execution note' },
];

describe('prompt scope policies', () => {
  it('defines exactly the supported phases', () => {
    expect(PROMPT_PHASES).toEqual(['plan', 'review', 'revision', 'verify', 'execute']);
  });

  it.each([
    ['plan', true],
    ['review', false],
    ['revision', false],
    ['verify', false],
    ['execute', false],
  ] as const)('%s broad repo context policy is deterministic', (phase, includesBroadContext) => {
    const selected = selectPromptMaterials(phase, materials);
    expect(selected.some((material) => material.kind === 'repo_file_context')).toBe(
      includesBroadContext,
    );
    expect(selected.some((material) => material.kind === 'repo_graph_context')).toBe(
      includesBroadContext,
    );
    expect(selected.map((material) => material.label)).toEqual(
      selectPromptMaterials(phase, [...materials].reverse())
        .map((material) => material.label)
        .sort((left, right) => {
          const order = selected.map((material) => material.label);
          return order.indexOf(left) - order.indexOf(right);
        }),
    );
  });

  it('allows verification-specific context without broad repo context', () => {
    const selected = selectPromptMaterials('verify', materials);
    expect(selected.map((material) => material.kind)).toEqual([
      'plan_output',
      'testing_context',
      'diff_summary',
      'verification_output',
    ]);
  });

  it('measures prompt payload character, byte, and line counts', () => {
    expect(measurePromptPayload('one\n€')).toEqual({
      characters: 5,
      bytes: 7,
      lines: 2,
    });
    expect(measurePromptPayload('')).toEqual({ characters: 0, bytes: 0, lines: 0 });
  });

  it('summarizes selected materials for telemetry', () => {
    expect(summarizePromptMaterials(selectPromptMaterials('execute', materials))).toEqual({
      count: 4,
      labels: ['issue', 'plan', 'review', 'tests'],
      kinds: ['issue_prompt', 'plan_output', 'review_feedback', 'testing_context'],
    });
  });

  it('sorts materials with the same kind by label', () => {
    const selected = selectPromptMaterials('plan', [
      { kind: 'repo_file_context', label: 'z-memory', content: 'z' },
      { kind: 'repo_file_context', label: 'a-memory', content: 'a' },
    ]);

    expect(selected.map((material) => material.label)).toEqual(['a-memory', 'z-memory']);
  });
});
