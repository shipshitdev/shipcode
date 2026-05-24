import { describe, expect, it } from 'vitest';
import type { PromptMaterial } from '../prompt-scope';
import {
  measurePhasePromptTelemetry,
  toPersistedPromptTelemetryMaterials,
} from './phase-prompt-telemetry';

const materials: PromptMaterial[] = [
  { kind: 'issue_prompt', label: 'issue', content: 'Issue body' },
  { kind: 'plan_output', label: 'plan', content: 'Approved plan' },
  { kind: 'repo_file_context', label: 'memory', content: 'Broad repo context' },
  { kind: 'testing_context', label: 'testing', content: 'bun test\nbun typecheck' },
  { kind: 'diff_summary', label: 'diff', content: 'diff --git a/file.ts' },
];

describe('phase prompt telemetry', () => {
  it('measures selected prompt materials using the phase policy', () => {
    const telemetry = measurePhasePromptTelemetry({
      phase: 'verify',
      prompt: 'Verify this\nprompt',
      materials,
    });

    expect(telemetry.phase).toBe('verify');
    expect(telemetry.promptSize).toEqual({ characters: 18, bytes: 18, lines: 2 });
    expect(telemetry.selectedMaterials).toEqual({
      count: 3,
      labels: ['plan', 'testing', 'diff'],
      kinds: ['plan_output', 'testing_context', 'diff_summary'],
    });
    expect(telemetry.selectedScope.allowedMaterialKinds).toContain('diff_summary');
    expect(telemetry.sections).toEqual([
      {
        label: 'plan',
        kind: 'plan_output',
        size: { characters: 13, bytes: 13, lines: 1 },
      },
      {
        label: 'testing',
        kind: 'testing_context',
        size: { characters: 22, bytes: 22, lines: 2 },
      },
      {
        label: 'diff',
        kind: 'diff_summary',
        size: { characters: 20, bytes: 20, lines: 1 },
      },
    ]);
  });

  it('persists selected material summaries and defaults missing summaries to empty', () => {
    const telemetry = measurePhasePromptTelemetry({
      phase: 'review',
      prompt: '',
      materials,
    });

    expect(toPersistedPromptTelemetryMaterials(telemetry)).toMatchObject({
      count: 3,
      labels: ['issue', 'plan', 'testing'],
      kinds: ['issue_prompt', 'plan_output', 'testing_context'],
      sections: expect.any(Array),
    });

    expect(
      toPersistedPromptTelemetryMaterials({
        ...telemetry,
        selectedMaterials: undefined as never,
        sections: [],
      }),
    ).toMatchObject({
      count: 0,
      labels: [],
      kinds: [],
      sections: [],
    });
  });
});
