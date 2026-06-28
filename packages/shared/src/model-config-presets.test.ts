import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import {
  buildAppSettingsModelPresetPatch,
  buildProjectModelPresetOverrides,
  GLOBAL_MODEL_CONFIG_PRESETS,
  getModelConfigPreset,
  MODEL_CONFIG_PRESETS,
} from './model-config-presets';
import { resolvePhaseModel, resolvePhaseModelId } from './model-resolution';

describe('model config presets', () => {
  it('builds the hybrid app settings patch from the shared preset definition', () => {
    const preset = getModelConfigPreset('hybrid');
    const patch = buildAppSettingsModelPresetPatch('hybrid');

    expect(preset.label).toBe('Hybrid');
    expect(patch).toMatchObject({
      plannerModel: 'claude',
      reviewerModel: 'codex',
      executorModel: 'codex',
      verifierModel: 'codex',
      plannerReasoningEffort: 'high',
      reviewerReasoningEffort: 'high',
      executorReasoningEffort: 'medium',
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
      plannerModelIdOverride: 'gpt-5.5',
      reviewerModelIdOverride: 'gpt-5.5',
      executorModelIdOverride: 'gpt-5.5',
      verifierModelIdOverride: 'gpt-5.5',
      plannerReasoningEffortOverride: 'xhigh',
      reviewerReasoningEffortOverride: 'high',
      executorReasoningEffortOverride: 'medium',
      verifierReasoningEffortOverride: 'high',
    });
  });

  it('builds opus-combo overrides: Opus 4.8 plans, GPT-5.5 codes, GPT-5.4 Mini verifies', () => {
    const preset = getModelConfigPreset('opus-combo');
    expect(preset.label).toBe('Opus combo');
    expect(preset.appliesTo).toBe('project');

    expect(buildProjectModelPresetOverrides('opus-combo')).toEqual({
      plannerModelOverride: 'claude',
      reviewerModelOverride: 'codex',
      executorModelOverride: 'codex',
      verifierModelOverride: 'codex',
      plannerModelIdOverride: 'claude-opus-4-8',
      reviewerModelIdOverride: 'gpt-5.5',
      executorModelIdOverride: 'gpt-5.5',
      verifierModelIdOverride: 'gpt-5.4-mini',
      // claude clamps xhigh -> high (CLI has no xhigh); codex keeps its tiers.
      plannerReasoningEffortOverride: 'high',
      reviewerReasoningEffortOverride: 'high',
      executorReasoningEffortOverride: 'medium',
      verifierReasoningEffortOverride: 'high',
    });
  });

  it('hides project-only presets from the global preset picker', () => {
    expect(MODEL_CONFIG_PRESETS.map((p) => p.key)).toContain('opus-combo');
    expect(GLOBAL_MODEL_CONFIG_PRESETS.map((p) => p.key)).not.toContain('opus-combo');
    expect(GLOBAL_MODEL_CONFIG_PRESETS.every((p) => p.appliesTo === 'all')).toBe(true);
  });

  it('honors the opus-combo Opus 4.8 model id end-to-end via project overrides', () => {
    const overrides = buildProjectModelPresetOverrides('opus-combo');
    // The global path pins the claude model, so the planner model id only
    // resolves to Opus 4.8 through the per-project override path.
    expect(resolvePhaseModel(DEFAULT_SETTINGS, overrides, 'planner')).toBe('claude');
    expect(resolvePhaseModelId(DEFAULT_SETTINGS, overrides, 'planner')).toBe('claude-opus-4-8');
    expect(resolvePhaseModelId(DEFAULT_SETTINGS, overrides, 'verifier')).toBe('gpt-5.4-mini');
  });
});
