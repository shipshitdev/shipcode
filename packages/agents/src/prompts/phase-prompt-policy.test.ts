import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRepoContextSlices } from '../context-loader';
import type { PromptMaterial } from '../prompt-scope';
import {
  PHASE_PROMPT_POLICY,
  resolvePhaseReasoningEffort,
  selectPhasePromptMaterials,
} from './phase-prompt-policy';

const materials: PromptMaterial[] = [
  { kind: 'issue_prompt', label: 'issue', content: 'Issue body' },
  { kind: 'plan_output', label: 'plan', content: 'Approved plan' },
  { kind: 'review_feedback', label: 'review', content: 'Review notes' },
  { kind: 'repo_file_context', label: 'memory', content: 'Broad repo context' },
  { kind: 'testing_context', label: 'testing', content: 'bun run test' },
  { kind: 'diff_summary', label: 'diff', content: 'diff --git a/file.ts' },
  { kind: 'verification_output', label: 'verify', content: 'Verification output' },
];

describe('phase prompt policy', () => {
  it('defines explicit policies for every pipeline phase', () => {
    expect(Object.keys(PHASE_PROMPT_POLICY)).toEqual([
      'plan',
      'review',
      'revision',
      'verify',
      'execute',
    ]);
  });

  it.each([
    ['review', false],
    ['verify', false],
    ['execute', false],
  ] as const)('excludes repo file context from %s prompts', (phase, expected) => {
    const selected = selectPhasePromptMaterials(phase, materials);
    expect(selected.some((material) => material.kind === 'repo_file_context')).toBe(expected);
  });

  it('keeps testing context independently selectable from repo context files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipcode-phase-policy-'));
    try {
      const memoryDir = join(dir, '.agents/memory');
      mkdirSync(memoryDir, { recursive: true });
      writeFileSync(join(memoryDir, 'MEMORY.md'), '# Memory\n\nArchitecture overview');
      writeFileSync(join(memoryDir, 'verification.md'), '# Verify\n\nbun run test');

      const slices = loadRepoContextSlices(dir);

      expect(slices.repoContextFiles.map((material) => material.label)).toEqual([
        '.agents/memory/MEMORY.md',
      ]);
      expect(slices.testingContext.map((material) => material.label)).toEqual([
        '.agents/memory/verification.md',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies lower-cost default reasoning only when no explicit override is provided', () => {
    expect(resolvePhaseReasoningEffort('review')).toBe('low');
    expect(resolvePhaseReasoningEffort('revision')).toBe('low');
    expect(resolvePhaseReasoningEffort('verify')).toBe('low');
    expect(resolvePhaseReasoningEffort('review', 'high')).toBe('high');
    expect(resolvePhaseReasoningEffort('execute')).toBe('medium');
  });
});
