import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import {
  getIssueCardPhase,
  getPipelineCardPhase,
  resolveEffectivePhaseReasoningEffort,
  resolveEffectivePhaseReasoningEffortForIssue,
  resolveExecutorModelForIssue,
  resolvePhaseModel,
  resolvePhaseModelForIssue,
  resolvePhaseModelId,
  resolvePhaseModelIdForIssue,
  resolvePhaseReasoningEffort,
  resolvePhaseReasoningEffortForIssue,
  resolveRevisionCount,
  resolveRevisionCountForIssue,
  resolveThreadPhasePresentation,
} from './model-resolution';
import type { AppSettings, GitHubIssueCacheRecord, Project, Thread } from './types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'shipcode',
    path: '/tmp/shipcode',
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
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
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
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

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    kind: 'pipeline',
    title: 'Test thread',
    prompt: 'Ship it',
    status: 'planning',
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    verifierModel: 'claude',
    executorModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: null,
    forkPointSha: null,
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
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

  it('lets issue phase overrides shadow project and global defaults', () => {
    const project = makeProject({ executorModelOverride: 'codex' });
    const issue = makeIssue({
      plannerModelOverride: 'openrouter',
      reviewerModelOverride: 'claude',
      executorModelOverride: 'openrouter',
      verifierModelOverride: 'claude',
    });

    expect(resolvePhaseModelForIssue(settings, project, issue, 'planner')).toBe('openrouter');
    expect(resolvePhaseModelForIssue(settings, project, issue, 'reviewer')).toBe('claude');
    expect(resolveExecutorModelForIssue(settings, project, issue)).toBe('openrouter');
    expect(resolvePhaseModelForIssue(settings, project, issue, 'verifier')).toBe('claude');
  });

  it('lets issue model IDs shadow project and provider defaults', () => {
    const project = makeProject({ executorModelIdOverride: 'gpt-5.4' });
    const issue = makeIssue({
      plannerModelIdOverride: 'claude-opus-4-6',
      reviewerModelIdOverride: 'gpt-5.4-mini',
      executorModelIdOverride: 'gpt-5.4',
      verifierModelIdOverride: 'anthropic/claude-sonnet-4-6',
      verifierModelOverride: 'openrouter',
    });

    expect(resolvePhaseModelIdForIssue(settings, project, issue, 'planner')).toBe(
      'claude-opus-4-6',
    );
    expect(resolvePhaseModelIdForIssue(settings, project, issue, 'reviewer')).toBe('gpt-5.4-mini');
    expect(resolvePhaseModelIdForIssue(settings, project, issue, 'executor')).toBe('gpt-5.4');
    expect(resolvePhaseModelIdForIssue(settings, project, issue, 'verifier')).toBe(
      'anthropic/claude-sonnet-4-6',
    );
  });

  it('resolves revision count through app and project inheritance', () => {
    expect(resolveRevisionCount(settings, makeProject())).toBe(0);
    expect(resolveRevisionCount({ ...settings, revisionCount: 2 }, makeProject())).toBe(2);
    expect(
      resolveRevisionCount(
        { ...settings, revisionCount: 1 },
        makeProject({ revisionCountOverride: 4 }),
      ),
    ).toBe(4);
  });

  it('lets issue revision overrides shadow project and app defaults', () => {
    const settingsWithRevisions: AppSettings = { ...settings, revisionCount: 1 };
    const project = makeProject({ revisionCountOverride: 3 });

    expect(resolveRevisionCountForIssue(settingsWithRevisions, project, makeIssue())).toBe(3);
    expect(
      resolveRevisionCountForIssue(
        settingsWithRevisions,
        project,
        makeIssue({ revisionCountOverride: 5 }),
      ),
    ).toBe(5);
    expect(
      resolveRevisionCountForIssue(
        { ...settingsWithRevisions, revisionCount: 0 },
        makeProject({ revisionCountOverride: null }),
        makeIssue({ revisionCountOverride: 2 }),
      ),
    ).toBe(2);
  });

  it('maps issue statuses to the current card phase', () => {
    expect(getIssueCardPhase('todo')).toBe('planner');
    expect(getIssueCardPhase('planning')).toBe('planner');
    expect(getIssueCardPhase('clarifying')).toBe('planner');
    expect(getIssueCardPhase('reviewing')).toBe('reviewer');
    expect(getIssueCardPhase('awaiting_approval')).toBe('planner');
    expect(getIssueCardPhase('executing')).toBe('executor');
    expect(getIssueCardPhase('testing')).toBe('executor');
    expect(getIssueCardPhase('verifying')).toBe('verifier');
    expect(getIssueCardPhase('failed')).toBeNull();
    expect(getIssueCardPhase('completed')).toBeNull();
    expect(getIssueCardPhase('done')).toBeNull();
  });

  it('maps pipeline phases to the current card phase', () => {
    expect(getPipelineCardPhase('planning')).toBe('planner');
    expect(getPipelineCardPhase('clarifying')).toBe('planner');
    expect(getPipelineCardPhase('revising')).toBe('planner');
    expect(getPipelineCardPhase('awaiting_approval')).toBe('planner');
    expect(getPipelineCardPhase('reviewing')).toBe('reviewer');
    expect(getPipelineCardPhase('executing')).toBe('executor');
    expect(getPipelineCardPhase('testing')).toBe('executor');
    expect(getPipelineCardPhase('verifying')).toBe('verifier');
    expect(getPipelineCardPhase('shipping')).toBe('verifier');
    expect(getPipelineCardPhase('failed')).toBeNull();
    expect(getPipelineCardPhase('completed')).toBeNull();
  });

  it('returns the global reasoning effort for the current phase', () => {
    const project = makeProject();
    expect(resolvePhaseReasoningEffort(settings, project, 'planner')).toBe('high');
    expect(resolvePhaseReasoningEffort(settings, project, 'reviewer')).toBe('medium');
    expect(resolvePhaseReasoningEffort(settings, project, 'executor')).toBe('low');
    expect(resolvePhaseReasoningEffort(settings, project, 'verifier')).toBe('high');
  });

  it('lets project overrides shadow the global reasoning effort', () => {
    const project = makeProject({
      plannerReasoningEffortOverride: 'low',
      reviewerReasoningEffortOverride: 'high',
    });

    expect(resolvePhaseReasoningEffort(settings, project, 'planner')).toBe('low');
    expect(resolvePhaseReasoningEffort(settings, project, 'reviewer')).toBe('high');
    expect(resolvePhaseReasoningEffort(settings, project, 'executor')).toBe('low');
  });

  it('resolves the effective reasoning effort for the selected provider', () => {
    const project = makeProject({
      plannerModelOverride: 'claude',
      plannerReasoningEffortOverride: 'low',
      reviewerModelOverride: 'codex',
      reviewerReasoningEffortOverride: 'xhigh',
    });

    expect(resolveEffectivePhaseReasoningEffort(settings, project, 'planner')).toBe('none');
    expect(resolveEffectivePhaseReasoningEffort(settings, project, 'reviewer')).toBe('xhigh');
  });

  it('uses issue-phase provider selection when resolving effective reasoning', () => {
    const project = makeProject({
      executorModelOverride: 'claude',
      executorReasoningEffortOverride: 'minimal',
    });
    const issue = makeIssue({ executorModelOverride: 'openrouter' });

    expect(resolveEffectivePhaseReasoningEffortForIssue(settings, project, issue, 'executor')).toBe(
      'minimal',
    );
    expect(resolveEffectivePhaseReasoningEffort(settings, project, 'executor')).toBe('none');
  });

  it('respects project-level effort override of none over global non-none', () => {
    const settingsWithHighPlanner: AppSettings = {
      ...settings,
      plannerModel: 'codex',
      plannerReasoningEffort: 'high',
    };
    const project = makeProject({
      plannerReasoningEffortOverride: 'none',
    });

    expect(resolvePhaseReasoningEffort(settingsWithHighPlanner, project, 'planner')).toBe('none');
  });

  it('respects issue-level effort override of none over project-level non-none', () => {
    const project = makeProject({
      plannerModelOverride: 'codex',
      plannerReasoningEffortOverride: 'high',
    });
    const issue = makeIssue({ plannerReasoningEffortOverride: 'none' });

    // Issue-level 'none' must win over project-level 'high'
    expect(resolvePhaseReasoningEffortForIssue(settings, project, issue, 'planner')).toBe('none');
  });

  it('resolves project model IDs ahead of global openrouter model settings', () => {
    const project = makeProject({
      plannerModelOverride: 'claude',
      plannerModelIdOverride: 'claude-opus-4-6',
      verifierModelOverride: 'openrouter',
      verifierModelIdOverride: 'qwen/qwen3-coder:free',
    });

    expect(resolvePhaseModelId(settings, project, 'planner')).toBe('claude-opus-4-6');
    expect(resolvePhaseModelId(settings, project, 'verifier')).toBe('qwen/qwen3-coder:free');
  });

  it('falls back to global openrouter model settings when no project model ID is set', () => {
    const project = makeProject({ verifierModelOverride: 'openrouter' });

    expect(resolvePhaseModelId(settings, project, 'planner')).toBeNull();
    expect(resolvePhaseModelId(settings, project, 'verifier')).toBeNull();

    const withOpenRouterDefaults: AppSettings = {
      ...settings,
      verifierModel: 'openrouter',
      openrouterVerifierModel: 'openrouter/auto',
    };
    expect(resolvePhaseModelId(withOpenRouterDefaults, project, 'verifier')).toBe(
      'openrouter/auto',
    );
  });

  it('prefers the thread phase provider and resolved model for live pipeline displays', () => {
    const project = makeProject({
      plannerModelOverride: 'claude',
      plannerReasoningEffortOverride: 'high',
    });
    const thread = makeThread({
      plannerModel: 'codex',
      plannerResolvedModel: 'gpt-5.4-mini',
      status: 'planning',
    });

    expect(resolveThreadPhasePresentation(settings, project, thread, 'planning')).toEqual({
      provider: 'codex',
      model: 'gpt-5.4-mini',
      effort: 'high',
    });
  });
});
