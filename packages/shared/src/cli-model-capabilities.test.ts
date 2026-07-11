import { describe, expect, it } from 'vitest';
import {
  assessCliModelAvailabilityFromCapabilities,
  assessCliReasoningEffortAvailabilityFromCapabilities,
  fallbackCliModelCapabilities,
} from './cli-model-capabilities';
import {
  CLAUDE_MODEL_OPTIONS,
  CLI_PROVIDER_FALLBACK_OPTIONS,
  CLI_PROVIDER_LABELS,
  CODEX_FALLBACK_MODEL_OPTIONS,
  CURSOR_FALLBACK_MODEL_OPTIONS,
  GEMINI_FALLBACK_MODEL_OPTIONS,
  GROK_FALLBACK_MODEL_OPTIONS,
} from './model-catalog';
import type { PhaseCliProvider, ReasoningEffort } from './types';

const PROVIDERS = [
  'claude',
  'codex',
  'gemini',
  'cursor',
  'grok',
] as const satisfies readonly PhaseCliProvider[];

describe('CLI provider mappings', () => {
  it('pins a display label for every phase CLI provider', () => {
    expect(CLI_PROVIDER_LABELS).toEqual({
      claude: 'Claude CLI',
      codex: 'Codex CLI',
      gemini: 'Gemini CLI',
      cursor: 'Cursor CLI',
      grok: 'Grok CLI',
    });
  });

  it('pins fallback model options for every phase CLI provider', () => {
    expect(CLI_PROVIDER_FALLBACK_OPTIONS).toEqual({
      claude: CLAUDE_MODEL_OPTIONS,
      codex: CODEX_FALLBACK_MODEL_OPTIONS,
      gemini: GEMINI_FALLBACK_MODEL_OPTIONS,
      cursor: CURSOR_FALLBACK_MODEL_OPTIONS,
      grok: GROK_FALLBACK_MODEL_OPTIONS,
    });
  });

  it('has a label and fallback entry for every provider (no gaps)', () => {
    for (const provider of PROVIDERS) {
      expect(CLI_PROVIDER_LABELS[provider]).toBeTruthy();
      expect(CLI_PROVIDER_FALLBACK_OPTIONS[provider].length).toBeGreaterThan(0);
    }
  });
});

describe('fallbackCliModelCapabilities', () => {
  it('resolves the correct fallback options per provider', () => {
    for (const provider of PROVIDERS) {
      const capabilities = fallbackCliModelCapabilities(provider);
      expect(capabilities.provider).toBe(provider);
      expect(capabilities.source).toBe('fallback');
      expect(capabilities.models.map((model) => model.value)).toEqual(
        CLI_PROVIDER_FALLBACK_OPTIONS[provider].map((option) => option.value),
      );
    }
  });
});

describe('assessCliModelAvailabilityFromCapabilities', () => {
  it('names the correct CLI in the message for every provider', () => {
    for (const provider of PROVIDERS) {
      const assessment = assessCliModelAvailabilityFromCapabilities(
        undefined,
        provider,
        'definitely-not-a-real-model',
      );
      expect(assessment.available).toBe(false);
      expect(assessment.message).toContain(CLI_PROVIDER_LABELS[provider]);
    }
  });
});

describe('assessCliReasoningEffortAvailabilityFromCapabilities', () => {
  // Each provider paired with an effort its default fallback model does not support.
  const unsupportedEffortByProvider: Record<PhaseCliProvider, ReasoningEffort> = {
    claude: 'low',
    codex: 'none',
    gemini: 'none',
    cursor: 'high',
    grok: 'high',
  };

  it('names the correct CLI in the message for every provider', () => {
    for (const provider of PROVIDERS) {
      const assessment = assessCliReasoningEffortAvailabilityFromCapabilities(
        undefined,
        provider,
        null,
        unsupportedEffortByProvider[provider],
      );
      expect(assessment.available).toBe(false);
      expect(assessment.message).toContain(CLI_PROVIDER_LABELS[provider]);
    }
  });
});
