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
    expect(SHIPCODE_STATUS_LABELS.map((label) => label.name)).toEqual(
      expect.arrayContaining(defaultStatuses),
    );
  });

  it('includes PR review status labels', () => {
    expect(SHIPCODE_STATUS_LABELS.map((label) => label.name)).toEqual(
      expect.arrayContaining(['status:needs-review', 'status:ready-to-merge']),
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

  it('includes the metadata labels used by PRD issue metadata', () => {
    expect(SHIPCODE_METADATA_LABELS.map((label) => label.name)).toEqual([
      'complexity:low',
      'complexity:medium',
      'complexity:high',
      'blast:contained',
      'blast:cross-package',
      'blast:cross-app',
      'blast:infra',
      'blocked:ci',
    ]);
  });
});
