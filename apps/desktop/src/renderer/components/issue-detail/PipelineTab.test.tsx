// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type {
  FeatureQaResult,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  PipelineCheckpoint,
  Thread,
} from '@shipcode/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineTab } from './PipelineTab';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Issue title',
    body: 'body',
    labels: ['shipcode:agent:claude'],
    assignee: null,
    state: 'open',
    pipelineStatus: 'verifying',
    threadId: 'thread-1',
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
    requireApprovalOverride: null,
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: new Date().toISOString(),
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread title',
    prompt: 'prompt',
    status: 'verifying',
    kind: 'pipeline',
    worktreeBranch: 'ship/42-issue-title',
    worktreePath: '/tmp/worktree',
    plannerModel: 'claude',
    reviewerModel: 'codex',
    executorModel: 'claude',
    verifierModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: true,
    baseBranch: 'main',
    forkPointSha: 'abc123',
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: 'acme/repo',
    automationId: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    pausedPhase: null,
    pausedAt: null,
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
    doneAt: null,
    ...overrides,
  };
}

function renderPipelineTab({
  issueOverrides = {},
  activeThreadId = 'thread-1',
  checkpoints = [],
  executorEditable = false,
  hasPrFeedbackBlockers = false,
  integrationStatus,
  isSubmitting = false,
  linkedPrUrl = null,
  onRestoreCheckpoint = vi.fn(),
  onStabilizePr = vi.fn(),
  qaResults = [],
  thread = makeThread(),
}: {
  issueOverrides?: Partial<GitHubIssueCacheRecord>;
  activeThreadId?: string | null;
  checkpoints?: PipelineCheckpoint[];
  executorEditable?: boolean;
  hasPrFeedbackBlockers?: boolean;
  integrationStatus?: IntegrationStatus;
  isSubmitting?: boolean;
  linkedPrUrl?: string | null;
  onRestoreCheckpoint?: (checkpoint: PipelineCheckpoint) => void;
  onStabilizePr?: () => void;
  qaResults?: FeatureQaResult[];
  thread?: Thread | null;
} = {}) {
  render(
    <PipelineTab
      activeIssue={makeIssue(issueOverrides)}
      activeThreadId={activeThreadId}
      checkpoints={checkpoints}
      currentPhaseReasoningEfforts={{
        planner: 'high',
        reviewer: 'high',
        executor: 'high',
        verifier: 'high',
      }}
      currentPhaseSelections={{
        planner: {
          provider: executorEditable ? 'gemini' : 'claude',
          modelId: executorEditable ? 'missing-gemini-model' : null,
        },
        reviewer: { provider: 'codex', modelId: null },
        executor: { provider: 'claude', modelId: null },
        verifier: { provider: 'claude', modelId: null },
      }}
      effectivePhaseResolvedModels={{
        planner: 'claude',
        reviewer: 'codex',
        executor: 'claude',
        verifier: 'claude',
      }}
      effectiveRequireApproval={false}
      effectiveRevisionCount={1}
      executorEditable={executorEditable}
      hasPrFeedbackBlockers={hasPrFeedbackBlockers}
      inheritedPhaseReasoningEfforts={{
        planner: 'high',
        reviewer: 'high',
        executor: 'high',
        verifier: 'high',
      }}
      inheritedRequireApproval={true}
      inheritedRevisionCount={0}
      integrationStatus={integrationStatus}
      isSubmitting={isSubmitting}
      linkedPrUrl={linkedPrUrl}
      phaseEffortSelectValues={{
        planner: '__inherit__',
        reviewer: '__inherit__',
        executor: '__inherit__',
        verifier: '__inherit__',
      }}
      phaseModelValidation={{}}
      qaResults={qaResults}
      phaseSelectValues={{
        planner: executorEditable ? 'gemini::missing-gemini-model' : '__inherit__',
        reviewer: '__inherit__',
        executor: '__inherit__',
        verifier: '__inherit__',
      }}
      projectDefaultPhaseSelections={{
        planner: { provider: 'claude', modelId: null },
        reviewer: { provider: 'codex', modelId: null },
        executor: { provider: 'claude', modelId: null },
        verifier: { provider: 'claude', modelId: null },
      }}
      requireApprovalSelectValue="__inherit__"
      revisionCountSelectValue="__inherit__"
      taskGraph={null}
      thread={thread}
      githubIssueUrl="https://github.com/acme/repo/issues/42"
      onPhaseAgentChange={vi.fn()}
      onPhaseEffortChange={vi.fn()}
      onRequireApprovalChange={vi.fn()}
      onRevisionCountChange={vi.fn()}
      onPhaseOpenRouterSlugBlur={vi.fn()}
      onRestoreCheckpoint={onRestoreCheckpoint}
      onStabilizePr={onStabilizePr}
    />,
  );
}

describe('PipelineTab', () => {
  beforeEach(() => {
    window.shipcode = {
      invoke: (() => Promise.resolve(null)) as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the persisted execution diff when available', () => {
    renderPipelineTab();

    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Branch')).toBeInTheDocument();
    expect(screen.getByText('ship/42-issue-title')).toBeInTheDocument();
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
  });

  it('shows a waiting message before a diff exists', () => {
    renderPipelineTab();

    expect(screen.getByText('Human Approval')).toBeInTheDocument();
    expect(screen.getByText('Revisions')).toBeInTheDocument();
    expect(screen.getByText('1 revision before approval/execution.')).toBeInTheDocument();
  });

  it('renders Gemini in editable thread-level phase selectors with degraded readiness', () => {
    renderPipelineTab({
      executorEditable: true,
      integrationStatus: {
        modelCapabilities: {
          gemini: {
            provider: 'gemini',
            source: 'unavailable',
            models: [],
            error: 'Gemini CLI is not authenticated.',
            checkedAt: '2026-05-08T00:00:00.000Z',
          },
        },
      } as unknown as IntegrationStatus,
    });

    expect(screen.getByText('missing-gemini-model (Unavailable)')).toBeInTheDocument();
    expect(screen.getByText(/missing-gemini-model is not reported/)).toBeInTheDocument();
    expect(screen.getByText('Human Approval')).toBeInTheDocument();
  });

  it('renders visual QA assertion evidence', () => {
    renderPipelineTab({
      qaResults: [
        {
          featureId: 'issue-42',
          status: 'failed',
          summary: 'Visual QA failed.',
          runAt: new Date().toISOString(),
          evidencePaths: ['/tmp/qa/create-button.png'],
          flowResults: [
            {
              flowName: 'Create button is pinned top left',
              passed: false,
              failureReason: 'wrong corner',
              evidencePaths: ['/tmp/qa/create-button.png'],
              assertions: [
                {
                  name: 'Create button is pinned top left',
                  passed: false,
                  expected: 'target left/top within 24px of container left/top',
                  actual: 'target x=900, y=700, w=80, h=32',
                  evidencePath: '/tmp/qa/create-button.png',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(screen.getByText('QA Results')).toBeInTheDocument();
    expect(screen.getAllByText('Create button is pinned top left')).toHaveLength(2);
    expect(
      screen.getByText('Expected: target left/top within 24px of container left/top'),
    ).toBeInTheDocument();
    expect(screen.getByText('Actual: target x=900, y=700, w=80, h=32')).toBeInTheDocument();
    expect(screen.getAllByText('/tmp/qa/create-button.png').length).toBeGreaterThan(0);
  });

  it('opens attached QA evidence through IPC', () => {
    const invoke = vi.fn(async () => null);
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      qaResults: [
        {
          featureId: 'issue-42',
          status: 'failed',
          summary: 'Visual QA failed.',
          runAt: new Date().toISOString(),
          evidencePaths: ['/tmp/qa/create-button.png'],
          flowResults: [],
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /open/i }));

    expect(invoke).toHaveBeenCalledWith('feature-qa:open-evidence', {
      threadId: 'thread-1',
      path: '/tmp/qa/create-button.png',
    });
  });

  it('renders human QA scenarios from the issue QA state', () => {
    renderPipelineTab({
      issueOverrides: {
        body: `## QA State

\`\`\`json
{
  "featureId": "issue-42",
  "routes": ["/settings"],
  "criticalFlows": [
    {
      "name": "Update profile name",
      "steps": ["Open settings", "Change the profile name", "Save the form"],
      "successCriteria": "The updated name remains visible after reload."
    }
  ],
  "expectedStates": ["Saved state", "Validation error state"],
  "testDataAssumptions": ["A signed-in user exists."],
  "selectorReadiness": "ready"
}
\`\`\``,
      },
    });

    expect(screen.getByText('Human QA')).toBeInTheDocument();
    expect(screen.getByText('/tmp/worktree')).toBeInTheDocument();
    expect(screen.getByText('/settings')).toBeInTheDocument();
    expect(screen.getByText('Update profile name')).toBeInTheDocument();
    expect(screen.getByText('Save the form')).toBeInTheDocument();
    expect(
      screen.getByText('Success: The updated name remains visible after reload.'),
    ).toBeInTheDocument();
  });

  it('restores an already running manual QA server for the active thread', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'feature-qa:get-server') {
        return { baseUrl: 'http://localhost:4321', port: 4321 };
      }
      return null;
    });
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      issueOverrides: {
        body: `## QA State

\`\`\`json
{
  "featureId": "issue-42",
  "routes": ["/settings"],
  "criticalFlows": [
    {
      "name": "Update profile name",
      "steps": ["Open settings"],
      "successCriteria": "Settings loads."
    }
  ],
  "expectedStates": ["Loaded state"],
  "testDataAssumptions": [],
  "selectorReadiness": "ready"
}
\`\`\``,
      },
    });

    expect(await screen.findByText('http://localhost:4321')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('feature-qa:get-server', { threadId: 'thread-1' });
  });

  it('opens and stops the manual QA server through IPC', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'feature-qa:get-server') return null;
      if (channel === 'feature-qa:start-server') {
        return { baseUrl: 'http://localhost:5173', port: 5173 };
      }
      return null;
    });
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      issueOverrides: {
        body: `## QA State

\`\`\`json
{
  "featureId": "issue-42",
  "routes": ["/settings"],
  "criticalFlows": [
    {
      "name": "Update profile name",
      "steps": ["Open settings"],
      "successCriteria": "Settings loads."
    }
  ],
  "expectedStates": [],
  "testDataAssumptions": [],
  "selectorReadiness": "ready"
}
\`\`\``,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByText('http://localhost:5173')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('feature-qa:start-server', {
      projectId: 'project-1',
      threadId: 'thread-1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('feature-qa:stop-server', { threadId: 'thread-1' });
    });
    expect(
      await screen.findByText(/starts the configured runtime qa command/i),
    ).toBeInTheDocument();
  });

  it('clamps and renders manual QA startup errors', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'feature-qa:get-server') return null;
      if (channel === 'feature-qa:start-server') {
        throw new Error(`dev server failed\n${'x'.repeat(1000)}`);
      }
      return null;
    });
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      issueOverrides: {
        body: `## QA State

\`\`\`json
{
  "featureId": "issue-42",
  "routes": [],
  "criticalFlows": [
    {
      "name": "Open settings",
      "steps": ["Open settings"],
      "successCriteria": "Settings loads."
    }
  ],
  "expectedStates": [],
  "testDataAssumptions": [],
  "selectorReadiness": "ready"
}
\`\`\``,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    const error = await screen.findByText(/^dev server failed/);
    expect(error.textContent?.length).toBeLessThanOrEqual(320);
  });

  it('renders PR feedback blockers and runs the stabilization action', () => {
    const onStabilizePr = vi.fn();

    renderPipelineTab({
      issueOverrides: {
        linkedPrNumber: 77,
        linkedPrUrl: 'https://github.com/acme/repo/pull/77',
        linkedPrIsDraft: true,
        ciBlocked: true,
        failingChecks: [
          {
            name: 'test',
            workflowName: 'CI',
            status: 'failed',
            conclusion: 'failure',
            detailsUrl: 'https://github.com/acme/repo/actions/runs/1',
          },
        ],
        unresolvedReviewCommentCount: 1,
        unresolvedReviewComments: [
          {
            author: 'octocat',
            body: 'Please cover the regression.',
            createdAt: '2026-05-01T10:00:00.000Z',
            path: 'src/foo.ts',
            line: 12,
            url: 'https://github.com/acme/repo/pull/77#discussion_r1',
          },
        ],
        prLastSyncAt: '2026-05-01T10:00:00.000Z',
      },
      hasPrFeedbackBlockers: true,
      linkedPrUrl: 'https://github.com/acme/repo/pull/77',
      onStabilizePr,
    });

    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('1 failing check')).toBeInTheDocument();
    expect(screen.getByText('1 unresolved review')).toBeInTheDocument();
    expect(screen.getByText('CI / test')).toBeInTheDocument();
    expect(screen.getByText('Please cover the regression.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /run stabilization pass/i }));

    expect(onStabilizePr).toHaveBeenCalledTimes(1);
  });

  it('opens PR feedback links through shell IPC', () => {
    const invoke = vi.fn(async () => null);
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      issueOverrides: {
        linkedPrNumber: 77,
        failingChecks: [
          {
            name: 'test',
            workflowName: 'CI',
            status: 'failed',
            conclusion: 'failure',
            detailsUrl: 'https://github.com/acme/repo/actions/runs/1',
          },
        ],
        unresolvedReviewCommentCount: 1,
        unresolvedReviewComments: [
          {
            author: 'octocat',
            body: 'Please cover the regression.',
            createdAt: '2026-05-01T10:00:00.000Z',
            path: 'src/foo.ts',
            line: 12,
            url: 'https://github.com/acme/repo/pull/77#discussion_r1',
          },
        ],
      },
      linkedPrUrl: 'https://github.com/acme/repo/pull/77',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open pull request on GitHub' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Comment' }));

    expect(invoke).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/acme/repo/pull/77',
    });
    expect(invoke).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/acme/repo/actions/runs/1',
    });
    expect(invoke).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/acme/repo/pull/77#discussion_r1',
    });
  });

  it('renders checkpoints and passes the selected checkpoint back for restore', () => {
    const checkpoint: PipelineCheckpoint = {
      id: 'checkpoint-1',
      threadId: 'thread-1',
      projectId: 'project-1',
      phase: 'verifying',
      reason: 'manual restore test',
      label: 'Before verifier retry',
      commitSha: 'abcdef1234567890',
      branch: 'ship/42-issue-title',
      createdAt: '2026-05-01T10:00:00.000Z',
    };
    const onRestoreCheckpoint = vi.fn();

    renderPipelineTab({ checkpoints: [checkpoint], onRestoreCheckpoint });

    expect(screen.getByText('Checkpoints')).toBeInTheDocument();
    expect(screen.getByText('Before verifier retry')).toBeInTheDocument();
    expect(screen.getByText(/ship\/42-issue-title .* abcdef123456/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(onRestoreCheckpoint).toHaveBeenCalledWith(checkpoint);
  });
});
