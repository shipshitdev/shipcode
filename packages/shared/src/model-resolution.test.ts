import { describe, expect, it } from 'vitest';
import type { AppSettings, GitHubIssueCacheRecord, Project } from './types';
import { DEFAULT_SETTINGS } from './constants';
import {
  getIssueCardPhase,
  resolveExecutorModelForIssue,
  resolvePhaseModel,
  resolvePhaseReasoningEffort,
} from './model-resolution';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'shipcode',
    path: '/tmp/shipcode',
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubProjectUrl: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Test issue',
    body: 'PRD body',
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: null,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: null,
    lastStatusLabel: null,
    executorModelOverride: null,
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('model-resolution', () => {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    executorModel: 'claude',
    verifierModel: 'openrouter',
    plannerReasoningEffort: 'high',
    reviewerReasoningEffort: 'medium',
    executorReasoningEffort: 'low',
    verifierReasoningEffort: 'high',
  };

  it('uses global settings when there are no project overrides', () => {
    const project = makeProject();

    expect(resolvePhaseModel(settings, project, 'planner')).toBe('claude');
    expect(resolvePhaseModel(settings, project, 'reviewer')).toBe('codex');
    expect(resolvePhaseModel(settings, project, 'executor')).toBe('claude');
    expect(resolvePhaseModel(settings, project, 'verifier')).toBe('openrouter');
  });

  it('lets project overrides shadow the global defaults', () => {
    const project = makeProject({
      plannerModelOverride: 'openrouter',
      reviewerModelOverride: 'claude',
      executorModelOverride: 'codex',
      verifierModelOverride: 'claude',
    });

    expect(resolvePhaseModel(settings, project, 'planner')).toBe('openrouter');
    expect(resolvePhaseModel(settings, project, 'reviewer')).toBe('claude');
    expect(resolvePhaseModel(settings, project, 'executor')).toBe('codex');
    expect(resolvePhaseModel(settings, project, 'verifier')).toBe('claude');
  });

  it('lets issue executor override shadow project and global defaults', () => {
    const project = makeProject({ executorModelOverride: 'codex' });
    const issue = makeIssue({ executorModelOverride: 'openrouter' });

    expect(resolveExecutorModelForIssue(settings, project, issue)).toBe('openrouter');
  });

  it('maps issue statuses to the current card phase', () => {
    expect(getIssueCardPhase('todo')).toBe('planner');
    expect(getIssueCardPhase('planning')).toBe('planner');
    expect(getIssueCardPhase('reviewing')).toBe('reviewer');
    expect(getIssueCardPhase('awaiting_approval')).toBe('executor');
    expect(getIssueCardPhase('executing')).toBe('executor');
    expect(getIssueCardPhase('verifying')).toBe('verifier');
    expect(getIssueCardPhase('failed')).toBeNull();
    expect(getIssueCardPhase('completed')).toBeNull();
  });

  it('returns the global reasoning effort for the current phase', () => {
    expect(resolvePhaseReasoningEffort(settings, 'planner')).toBe('high');
    expect(resolvePhaseReasoningEffort(settings, 'reviewer')).toBe('medium');
    expect(resolvePhaseReasoningEffort(settings, 'executor')).toBe('low');
    expect(resolvePhaseReasoningEffort(settings, 'verifier')).toBe('high');
  });
});
