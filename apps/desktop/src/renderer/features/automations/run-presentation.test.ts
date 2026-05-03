import { describe, expect, it } from 'vitest';
import { describeAutomationRun, getAutomationRunTotalTokens } from './run-presentation';

describe('getAutomationRunTotalTokens', () => {
  it('adds prompt and completion tokens', () => {
    expect(
      getAutomationRunTotalTokens({
        totalTokensPrompt: 1200,
        totalTokensCompletion: 0,
        lastError: null,
        totalCostUsd: 0,
        executorResolvedModel: null,
      }),
    ).toBe(1200);
  });
});

describe('describeAutomationRun', () => {
  it('formats cost, tokens, and model details in the existing UI order', () => {
    expect(
      describeAutomationRun({
        totalCostUsd: 1.25,
        totalTokensPrompt: 1500,
        totalTokensCompletion: 500,
        executorResolvedModel: 'gpt-5',
        lastError: null,
      }),
    ).toBe('$1.25 · 2k tokens · gpt-5');
  });

  it('truncates lastError when present and skips the computed summary', () => {
    expect(
      describeAutomationRun(
        {
          lastError: 'x'.repeat(150),
          totalCostUsd: 1.25,
          totalTokensPrompt: 1500,
          totalTokensCompletion: 500,
          executorResolvedModel: 'gpt-5',
        },
        { errorMaxLength: 120 },
      ),
    ).toBe('x'.repeat(120));
  });
});
