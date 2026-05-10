import { describe, expect, it } from 'vitest';
import { extractFencedBlock, type FencedSchema } from './fenced-output';

interface Artifact {
  objective?: string;
  planId?: string;
  criteriaResults?: unknown[];
  note?: string;
}

const passthroughSchema: FencedSchema<Artifact> = {
  parse(data: unknown): Artifact {
    if (!data || typeof data !== 'object') {
      throw new Error('expected object');
    }
    return data as Artifact;
  },
};

const rejectingSchema: FencedSchema<Artifact> = {
  parse() {
    throw new Error('schema rejected');
  },
};

describe('extractFencedBlock', () => {
  it('extracts loose JSON with escaped strings when no fence is present', () => {
    const result = extractFencedBlock(
      'prefix {"objective":"Ship \\"quoted\\" text","note":"brace } inside string"} suffix',
      'shipcode-plan',
      passthroughSchema,
    );

    expect(result.success).toBe(true);
    expect(result.data?.objective).toBe('Ship "quoted" text');
    expect(result.raw).toContain('```shipcode-plan');
  });

  it('reports schema failures for loose JSON matches', () => {
    const result = extractFencedBlock(
      'prefix {"planId":"plan-1"} suffix',
      'shipcode-review',
      rejectingSchema,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('JSON found but schema validation failed');
    expect(result.raw).toContain('```shipcode-review');
  });

  it('returns no-fence errors when marker JSON is incomplete', () => {
    const result = extractFencedBlock(
      'prefix {"criteriaResults":[{"criterion":"tests","passed":true}',
      'shipcode-verification',
      passthroughSchema,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('No shipcode-verification fenced block found');
  });

  it('returns no-fence errors when marker text has no opening brace', () => {
    const result = extractFencedBlock(
      'prefix "objective": "missing object wrapper"',
      'shipcode-plan',
      passthroughSchema,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('No shipcode-plan fenced block found');
  });

  it('returns the schema error from the last matching fenced block', () => {
    const result = extractFencedBlock(
      '```shipcode-plan\n{"objective":"x"}\n```\n```shipcode-plan\n[]\n```',
      'shipcode-plan',
      rejectingSchema,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('schema rejected');
  });
});
