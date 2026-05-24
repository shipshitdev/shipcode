import { describe, expect, it } from 'vitest';
import { unwrapCliResultEnvelope } from './cli-result';

describe('unwrapCliResultEnvelope', () => {
  it('returns the result field from a JSON envelope', () => {
    expect(
      unwrapCliResultEnvelope(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: '```shipcode-prd\n{"body":"# PRD: test"}\n```',
        }),
      ),
    ).toBe('```shipcode-prd\n{"body":"# PRD: test"}\n```');
  });

  it('returns raw stdout when the payload is not a result envelope', () => {
    expect(unwrapCliResultEnvelope('plain text')).toBe('plain text');
  });
});
