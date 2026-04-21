import { describe, expect, it } from 'vitest';
import {
  buildAppSettingsModelPresetPatch,
  buildProjectModelPresetOverrides,
  getModelConfigPreset,
} from './model-config-presets';

describe('model config presets', () => {
  it('builds the hybrid app settings patch from the shared preset definition', () => {
    const preset = getModelConfigPreset('hybrid');
    const patch = buildAppSettingsModelPresetPatch('hybrid');

    expect(preset.label).toBe('Hybrid');
    expect(patch).toMatchObject({
      plannerModel: 'claude',
      reviewerModel: 'codex',
      executorModel: 'claude',
      verifierModel: 'claude',
      plannerReasoningEffort: 'high',
      reviewerReasoningEffort: 'high',
      executorReasoningEffort: 'high',
      verifierReasoningEffort: 'high',
      prdRewriteCli: 'claude',
      prdRewriteClaudeModel: 'claude-sonnet-4-6',
      prdRewriteCodexModel: 'gpt-5.4-mini',
      prdRewriteReasoningEffort: 'none',
    });
  });

  it('builds codex project overrides with explicit model ids for every phase', () => {
    const overrides = buildProjectModelPresetOverrides('codex');

    expect(overrides).toEqual({
      plannerModelOverride: 'codex',
      reviewerModelOverride: 'codex',
      executorModelOverride: 'codex',
      verifierModelOverride: 'codex',
      plannerModelIdOverride: 'gpt-5.4',
      reviewerModelIdOverride: 'gpt-5.4',
      executorModelIdOverride: 'gpt-5.4',
      verifierModelIdOverride: 'gpt-5.4',
      plannerReasoningEffortOverride: 'high',
      reviewerReasoningEffortOverride: 'high',
      executorReasoningEffortOverride: 'high',
      verifierReasoningEffortOverride: 'high',
    });
  });
});
