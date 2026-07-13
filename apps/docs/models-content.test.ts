import { readFileSync } from 'node:fs';
import {
  CLAUDE_MODEL_OPTIONS,
  CODEX_FALLBACK_MODEL_OPTIONS,
  CURSOR_FALLBACK_MODEL_OPTIONS,
  GEMINI_FALLBACK_MODEL_OPTIONS,
  GROK_FALLBACK_MODEL_OPTIONS,
  MODEL_CONFIG_PRESETS,
  MODEL_SLUG_ALIASES,
  OPENROUTER_MODEL_OPTIONS,
} from '@shipcode/shared';
import { describe, expect, it } from 'vitest';

const modelsPage = readFileSync(new URL('./content/models.mdx', import.meta.url), 'utf8');

describe('models documentation', () => {
  it('names every curated model and preset', () => {
    const modelIds = [
      ...CLAUDE_MODEL_OPTIONS,
      ...CODEX_FALLBACK_MODEL_OPTIONS,
      ...GEMINI_FALLBACK_MODEL_OPTIONS,
      ...CURSOR_FALLBACK_MODEL_OPTIONS,
      ...GROK_FALLBACK_MODEL_OPTIONS,
      ...OPENROUTER_MODEL_OPTIONS,
    ].map((option) => option.value);

    for (const modelId of new Set(modelIds)) {
      expect(modelsPage).toContain(`\`${modelId}\``);
    }
    for (const preset of MODEL_CONFIG_PRESETS) {
      expect(modelsPage).toContain(`\`${preset.key}\``);
    }
  });

  it('documents every accepted model alias', () => {
    for (const alias of Object.keys(MODEL_SLUG_ALIASES)) {
      expect(modelsPage).toContain(`\`${alias}\``);
    }
  });
});
