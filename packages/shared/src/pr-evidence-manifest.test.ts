import { describe, expect, it } from 'vitest';
import {
  deserializePrEvidenceManifest,
  type PrEvidenceManifest,
  prEvidenceManifestSchema,
  serializePrEvidenceManifest,
} from './pr-evidence-manifest';

function manifest(overrides: Partial<PrEvidenceManifest> = {}): PrEvidenceManifest {
  return {
    schemaVersion: 1,
    revision: 1,
    threadId: 'thread-1',
    planId: 'plan-1',
    createdAt: '2026-07-20T00:00:00.000Z',
    issue: {
      repository: 'shipshitdev/shipcode',
      number: 416,
      title: 'Define the PR evidence manifest',
      acceptanceCriteria: [{ id: 'criterion-1', text: 'Validate every evidence identifier.' }],
    },
    plan: {
      id: 'plan-1',
      version: 1,
      objective: 'Define a durable evidence contract.',
      lockedAt: '2026-07-20T00:00:00.000Z',
      steps: [
        {
          id: 'step-1',
          order: 1,
          description: 'Define the contract.',
          files: ['packages/shared/src/pr-evidence-manifest.ts'],
        },
      ],
    },
    changes: {
      baseSha: 'cb79f468ac81ee41603060ee878b4340c648c163',
      headSha: 'cb79f468ac81ee41603060ee878b4340c648c163',
      commits: [],
      files: [],
      scopeDrift: [],
    },
    verification: {
      criteria: [{ subjectId: 'criterion-1', state: 'proven', evidenceIds: ['test-1'] }],
      planSteps: [{ subjectId: 'step-1', state: 'proven', evidenceIds: ['test-1'] }],
      checks: [],
    },
    permissions: {
      capabilities: [
        {
          capability: 'repository_write',
          status: 'granted',
          source: 'automation scope',
          evidenceIds: [],
        },
      ],
      approvals: [],
    },
    unresolvedRisks: [],
    evidence: [
      {
        id: 'test-1',
        kind: 'test',
        label: 'Focused manifest validation',
        locator: 'ci://run/123',
      },
    ],
    ...overrides,
  };
}

describe('prEvidenceManifestSchema', () => {
  it('validates complete criterion and locked-plan evidence coverage', () => {
    expect(prEvidenceManifestSchema.parse(manifest())).toMatchObject({
      schemaVersion: 1,
      threadId: 'thread-1',
      planId: 'plan-1',
    });
  });

  it('rejects missing criterion coverage and unknown evidence identifiers', () => {
    const input = manifest();
    input.verification.criteria = [];
    input.verification.planSteps[0].evidenceIds = ['missing-evidence'];

    const result = prEvidenceManifestSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'Missing evidence state for acceptance criterion: criterion-1',
        'Unknown evidence identifier: missing-evidence',
      ]),
    );
  });

  it('requires explicit reasons for unavailable evidence states', () => {
    const input = manifest();
    input.verification.criteria[0] = {
      subjectId: 'criterion-1',
      state: 'blocked',
      evidenceIds: [],
    };

    expect(prEvidenceManifestSchema.safeParse(input).success).toBe(false);
    input.verification.criteria[0].reason = 'CI is unavailable.';
    expect(prEvidenceManifestSchema.safeParse(input).success).toBe(true);
  });

  it('redacts secret-like content before serialization and display', () => {
    const input = manifest();
    input.evidence[0].summary =
      'Authorization: Bearer abc123 {"password":"hunter2"} github_pat_abcdefghijklmnop AKIA1234567890ABCDEF xoxb-123-secret eyJheader.payload.signature';

    const serialized = serializePrEvidenceManifest(input);
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('github_pat_abcdefghijklmnop');
    expect(serialized).not.toContain('AKIA1234567890ABCDEF');
    expect(serialized).not.toContain('xoxb-123-secret');
    expect(serialized).not.toContain('eyJheader.payload.signature');
    expect(deserializePrEvidenceManifest(serialized).evidence[0].summary).toContain('[REDACTED]');
  });

  it('keeps raw log evidence addressable and bounded', () => {
    const input = manifest();
    input.evidence[0] = {
      id: 'test-1',
      kind: 'log',
      label: 'CI log',
      summary: 'x'.repeat(2_001),
    };

    expect(prEvidenceManifestSchema.safeParse(input).success).toBe(false);
    input.evidence[0] = {
      id: 'test-1',
      kind: 'log',
      label: 'CI log',
      locator: 'ci://run/123/logs/test',
      summary: 'Bounded excerpt.',
    };
    expect(prEvidenceManifestSchema.safeParse(input).success).toBe(true);
  });
});
