import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_LABEL_MAPPINGS,
  SHIPCODE_AGENT_LABELS,
  SHIPCODE_DEFAULT_LABELS,
  SHIPCODE_METADATA_LABELS,
  SHIPCODE_STATUS_LABELS,
} from './index';

describe('SHIPCODE_DEFAULT_LABELS', () => {
  it('contains unique label names', () => {
    const names = SHIPCODE_DEFAULT_LABELS.map((label) => label.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every configured non-empty status label mapping', () => {
    const defaultStatuses = [
      ...new Set(Object.values(DEFAULT_STATUS_LABEL_MAPPINGS).filter(Boolean)),
    ];
    expect(defaultStatuses).toEqual([]);
    expect(SHIPCODE_STATUS_LABELS).toEqual([]);
  });

  it('does not create workflow status labels', () => {
    expect(SHIPCODE_DEFAULT_LABELS.map((label) => label.name)).not.toEqual(
      expect.arrayContaining([
        'status:queued',
        'status:in-progress',
        'status:needs-review',
        'status:ready-to-merge',
        'status:done',
        'status:failed',
      ]),
    );
  });

  it('includes the agent routing labels ShipCode already documents', () => {
    expect(SHIPCODE_AGENT_LABELS.map((label) => label.name)).toEqual([
      'agent:claude',
      'agent:codex',
      'agent:openrouter',
      'agent:openrouter/auto',
      'agent:openrouter/free',
    ]);
  });

  it('keeps only labels that are not covered by native GitHub/project fields', () => {
    const labelNames = SHIPCODE_DEFAULT_LABELS.map((label) => label.name);
    expect(SHIPCODE_METADATA_LABELS.map((label) => label.name)).toEqual(['blocked:ci']);
    expect(labelNames.some((name) => name.startsWith('complexity:'))).toBe(false);
    expect(labelNames.some((name) => name.startsWith('blast:'))).toBe(false);
  });
});
