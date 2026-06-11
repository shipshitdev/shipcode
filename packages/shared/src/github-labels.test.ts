import { describe, expect, it } from 'vitest';
import {
  agentLabelForExecutor,
  displayAgentLabel,
  isAgentRoutingLabel,
  isPipelineStateLabel,
  macroColumnForStatus,
  normalizeAgentRoutingLabel,
  PIPELINE_LABEL_PREFIX,
  pipelineLabelForStatus,
  pipelineStatusFromLabel,
  pipelineStatusFromLabels,
  SHIPCODE_LABEL_PREFIX,
} from './github-labels';
import {
  SHIPCODE_AGENT_LABELS,
  SHIPCODE_DEFAULT_LABELS,
  SHIPCODE_METADATA_LABELS,
  SHIPCODE_PIPELINE_LABELS,
  SHIPCODE_STATUS_LABELS,
} from './index';
import { ISSUE_PIPELINE_STATUS } from './types';

describe('SHIPCODE_DEFAULT_LABELS', () => {
  it('contains unique label names', () => {
    const names = SHIPCODE_DEFAULT_LABELS.map((label) => label.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('SHIPCODE_STATUS_LABELS aliases SHIPCODE_PIPELINE_LABELS', () => {
    expect(SHIPCODE_STATUS_LABELS).toBe(SHIPCODE_PIPELINE_LABELS);
  });

  it('does not create old workflow status: labels', () => {
    const labelNames = SHIPCODE_DEFAULT_LABELS.map((label) => label.name);
    expect(labelNames.some((name) => name.startsWith('status:'))).toBe(false);
    expect(labelNames.some((name) => name.startsWith('agent:'))).toBe(false);
    expect(labelNames.some((name) => name.startsWith('pipeline:'))).toBe(false);
  });

  it('keeps managed labels in the ShipCode namespace', () => {
    for (const label of SHIPCODE_DEFAULT_LABELS) {
      expect(label.name.startsWith(SHIPCODE_LABEL_PREFIX)).toBe(true);
    }
  });

  it('includes the agent routing labels ShipCode already documents', () => {
    expect(SHIPCODE_AGENT_LABELS.map((label) => label.name)).toEqual([
      'shipcode:agent:claude',
      'shipcode:agent:codex',
      'shipcode:agent:openrouter',
      'shipcode:agent:openrouter/auto',
      'shipcode:agent:openrouter/free',
    ]);
  });

  it('keeps only labels that are not covered by native GitHub/project fields', () => {
    const labelNames = SHIPCODE_DEFAULT_LABELS.map((label) => label.name);
    expect(SHIPCODE_METADATA_LABELS.map((label) => label.name)).toEqual(['shipcode:blocked:ci']);
    expect(labelNames.some((name) => name.startsWith('complexity:'))).toBe(false);
    expect(labelNames.some((name) => name.startsWith('blast:'))).toBe(false);
  });
});

describe('agent routing labels', () => {
  it('leaves unrelated labels unchanged', () => {
    expect(isAgentRoutingLabel('enhancement')).toBe(false);
    expect(normalizeAgentRoutingLabel('enhancement')).toBe('enhancement');
    expect(displayAgentLabel('enhancement')).toBe('enhancement');
  });
});

describe('SHIPCODE_PIPELINE_LABELS', () => {
  it('has at least one label', () => {
    expect(SHIPCODE_PIPELINE_LABELS.length).toBeGreaterThan(0);
  });

  it('all labels use pipeline: prefix', () => {
    for (const label of SHIPCODE_PIPELINE_LABELS) {
      expect(label.name).toMatch(/^shipcode:pipeline:/);
    }
  });

  it('includes pipeline labels in SHIPCODE_DEFAULT_LABELS', () => {
    const defaultNames = SHIPCODE_DEFAULT_LABELS.map((l) => l.name);
    for (const label of SHIPCODE_PIPELINE_LABELS) {
      expect(defaultNames).toContain(label.name);
    }
  });
});

describe('pipelineLabelForStatus', () => {
  it('returns null for non-agent-loop statuses', () => {
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.todo)).toBeNull();
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.closed)).toBeNull();
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.deferred)).toBeNull();
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.completed)).toBeNull();
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.approval)).toBeNull();
  });

  it('returns correct label for agent-loop statuses', () => {
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.planning)).toBe(
      'shipcode:pipeline:planning',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.executing)).toBe(
      'shipcode:pipeline:executing',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.reviewing)).toBe(
      'shipcode:pipeline:reviewing',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.revising)).toBe(
      'shipcode:pipeline:revising',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.queued)).toBe('shipcode:pipeline:queued');
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.testing)).toBe('shipcode:pipeline:testing');
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.verifying)).toBe(
      'shipcode:pipeline:verifying',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.shipping)).toBe(
      'shipcode:pipeline:shipping',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.needsReview)).toBe(
      'shipcode:pipeline:needs_review',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.readyToMerge)).toBe(
      'shipcode:pipeline:ready_to_merge',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.clarifying)).toBe(
      'shipcode:pipeline:clarifying',
    );
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.paused)).toBe('shipcode:pipeline:paused');
    expect(pipelineLabelForStatus(ISSUE_PIPELINE_STATUS.failed)).toBe('shipcode:pipeline:failed');
  });

  it('all returned labels start with PIPELINE_LABEL_PREFIX', () => {
    const allStatuses = Object.values(ISSUE_PIPELINE_STATUS);
    for (const status of allStatuses) {
      const label = pipelineLabelForStatus(status);
      if (label !== null) {
        expect(label.startsWith(PIPELINE_LABEL_PREFIX)).toBe(true);
      }
    }
  });
});

describe('label helpers', () => {
  it('detects namespaced and legacy routing labels', () => {
    expect(isAgentRoutingLabel('shipcode:agent:codex')).toBe(true);
    expect(isAgentRoutingLabel('agent:codex')).toBe(true);
    expect(isAgentRoutingLabel('shipcode:pipeline:queued')).toBe(false);
  });

  it('normalizes legacy routing labels to the ShipCode namespace', () => {
    expect(normalizeAgentRoutingLabel('agent:openrouter/auto')).toBe(
      'shipcode:agent:openrouter/auto',
    );
    expect(normalizeAgentRoutingLabel('shipcode:agent:codex')).toBe('shipcode:agent:codex');
  });

  it('detects only namespaced pipeline state labels', () => {
    expect(isPipelineStateLabel('shipcode:pipeline:queued')).toBe(true);
    expect(isPipelineStateLabel('shipcode:agent:codex')).toBe(false);
  });

  it('maps namespaced pipeline labels back to issue statuses', () => {
    expect(pipelineStatusFromLabel('shipcode:pipeline:paused')).toBe(ISSUE_PIPELINE_STATUS.paused);
    expect(pipelineStatusFromLabel('shipcode:pipeline:queued')).toBe(ISSUE_PIPELINE_STATUS.queued);
    expect(pipelineStatusFromLabel('shipcode:pipeline:unknown')).toBeNull();
    expect(pipelineStatusFromLabel('enhancement')).toBeNull();
  });

  it('resolves multiple pipeline labels with terminal/manual states first', () => {
    expect(
      pipelineStatusFromLabels([
        'shipcode:pipeline:queued',
        'shipcode:pipeline:executing',
        'shipcode:pipeline:failed',
      ]),
    ).toBe(ISSUE_PIPELINE_STATUS.failed);
    expect(pipelineStatusFromLabels(['shipcode:pipeline:queued', 'shipcode:pipeline:paused'])).toBe(
      ISSUE_PIPELINE_STATUS.paused,
    );
    expect(pipelineStatusFromLabels(['enhancement'])).toBeNull();
  });

  it('formats agent labels for display', () => {
    expect(agentLabelForExecutor('codex')).toBe('shipcode:agent:codex');
    expect(displayAgentLabel('shipcode:agent:openrouter/auto')).toBe('openrouter/auto');
    expect(displayAgentLabel('agent:codex')).toBe('codex');
    expect(displayAgentLabel('custom')).toBe('custom');
  });
});

describe('macroColumnForStatus', () => {
  it('maps todo → todo', () => {
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.todo)).toBe('todo');
  });

  it('maps agent-loop statuses → in_progress', () => {
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.queued)).toBe('in_progress');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.planning)).toBe('in_progress');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.reviewing)).toBe('in_progress');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.revising)).toBe('in_progress');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.executing)).toBe('in_progress');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.testing)).toBe('in_progress');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.verifying)).toBe('in_progress');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.shipping)).toBe('in_progress');
  });

  it('maps human-review statuses → human_review', () => {
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.clarifying)).toBe('human_review');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.approval)).toBe('human_review');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.needsReview)).toBe('human_review');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.readyToMerge)).toBe('human_review');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.paused)).toBe('human_review');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.failed)).toBe('human_review');
  });

  it('maps Done-column statuses to the GitHub Done macro column', () => {
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.completed)).toBe('done');
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.closed)).toBe('done');
  });

  it('maps deferred → deferred', () => {
    expect(macroColumnForStatus(ISSUE_PIPELINE_STATUS.deferred)).toBe('deferred');
  });

  it('falls back to todo for unknown statuses', () => {
    expect(macroColumnForStatus('unknown' as never)).toBe('todo');
  });
});
