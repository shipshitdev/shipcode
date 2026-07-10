// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type {
  FeatureQaResult,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  ReasoningEffort,
  TaskGraphWithNodes,
  Thread,
} from '@shipcode/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineTab } from './PipelineTab';
import type { PhaseKey, PhaseSelection } from './tab-types';

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
  currentPhaseReasoningEfforts,
  currentPhaseSelections,
  phaseEffortSelectValues,
  phaseModelValidation = {},
  phaseSelectValues,
  onRestoreCheckpoint = vi.fn(),
  onPhaseAgentChange = vi.fn(),
  onPhaseEffortChange = vi.fn(),
  onPhaseOpenRouterSlugBlur = vi.fn(),
  onStabilizePr = vi.fn(),
  qaResults = [],
  taskGraph = null,
  thread = makeThread(),
  githubIssueUrl = 'https://github.com/acme/repo/issues/42',
}: {
  issueOverrides?: Partial<GitHubIssueCacheRecord>;
  activeThreadId?: string | null;
  checkpoints?: PipelineCheckpoint[];
  executorEditable?: boolean;
  hasPrFeedbackBlockers?: boolean;
  integrationStatus?: IntegrationStatus;
  isSubmitting?: boolean;
  currentPhaseReasoningEfforts?: Record<PhaseKey, ReasoningEffort>;
  currentPhaseSelections?: Record<PhaseKey, PhaseSelection>;
  phaseEffortSelectValues?: Record<PhaseKey, string>;
  phaseModelValidation?: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  phaseSelectValues?: Record<PhaseKey, string>;
  onRestoreCheckpoint?: (checkpoint: PipelineCheckpoint) => void;
  onPhaseAgentChange?: (phase: PhaseKey, value: string) => void;
  onPhaseEffortChange?: (phase: PhaseKey, effort: string) => void;
  onPhaseOpenRouterSlugBlur?: (phase: PhaseKey, rawValue: string) => void;
  onStabilizePr?: () => void;
  qaResults?: FeatureQaResult[];
  taskGraph?: TaskGraphWithNodes | null;
  thread?: Thread | null;
  githubIssueUrl?: string | null;
} = {}) {
  const resolvedCurrentPhaseSelections = currentPhaseSelections ?? {
    planner: {
      provider: executorEditable ? 'gemini' : 'claude',
      modelId: executorEditable ? 'missing-gemini-model' : null,
    },
    reviewer: { provider: 'codex', modelId: null },
    executor: { provider: 'claude', modelId: null },
    verifier: { provider: 'claude', modelId: null },
  };

  render(
    <PipelineTab
      activeIssue={makeIssue(issueOverrides)}
      activeThreadId={activeThreadId}
      checkpoints={checkpoints}
      currentPhaseReasoningEfforts={
        currentPhaseReasoningEfforts ?? {
          planner: 'high',
          reviewer: 'high',
          executor: 'high',
          verifier: 'high',
        }
      }
      currentPhaseSelections={resolvedCurrentPhaseSelections}
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
      phaseEffortSelectValues={
        phaseEffortSelectValues ?? {
          planner: '__inherit__',
          reviewer: '__inherit__',
          executor: '__inherit__',
          verifier: '__inherit__',
        }
      }
      phaseModelValidation={phaseModelValidation}
      qaResults={qaResults}
      phaseSelectValues={
        phaseSelectValues ?? {
          planner: executorEditable ? 'gemini::missing-gemini-model' : '__inherit__',
          reviewer: '__inherit__',
          executor: '__inherit__',
          verifier: '__inherit__',
        }
      }
      projectDefaultPhaseSelections={{
        planner: { provider: 'claude', modelId: null },
        reviewer: { provider: 'codex', modelId: null },
        executor: { provider: 'claude', modelId: null },
        verifier: { provider: 'claude', modelId: null },
      }}
      requireApprovalSelectValue="__inherit__"
      revisionCountSelectValue="__inherit__"
      taskGraph={taskGraph}
      thread={thread}
      githubIssueUrl={githubIssueUrl}
      onPhaseAgentChange={onPhaseAgentChange}
      onPhaseEffortChange={onPhaseEffortChange}
      onRequireApprovalChange={vi.fn()}
      onRevisionCountChange={vi.fn()}
      onPhaseOpenRouterSlugBlur={onPhaseOpenRouterSlugBlur}
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
    expect(screen.queryByText('Branch')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
  });

  it('shows a waiting message before a diff exists', () => {
    renderPipelineTab();

    expect(screen.getByText('Human Approval')).toBeInTheDocument();
    expect(screen.getByText('Revisions')).toBeInTheDocument();
    expect(screen.getByText('1 revision before approval/execution.')).toBeInTheDocument();
  });

  it('renders an issue worktree app runner without feature QA metadata', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'feature-qa:get-server') return null;
      if (channel === 'feature-qa:start-server') {
        return { baseUrl: 'http://localhost:5173', port: 5173 };
      }
      return null;
    });
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      issueOverrides: { body: 'plain issue body' },
    });

    expect(screen.getByText('Run app')).toBeInTheDocument();
    expect(screen.getByText('/tmp/worktree')).toBeInTheDocument();
    expect(
      screen.getByText(/starts the configured runtime qa command in this issue worktree/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Human QA')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByText('http://localhost:5173')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('feature-qa:start-server', {
      projectId: 'project-1',
      threadId: 'thread-1',
    });
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

  it('opens nested QA assertion and flow evidence through IPC', () => {
    const invoke = vi.fn(async () => null);
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      qaResults: [
        {
          featureId: 'issue-42',
          status: 'partial',
          summary: 'Visual QA partially passed.',
          runAt: new Date().toISOString(),
          evidencePaths: [],
          flowResults: [
            {
              flowName: 'Review evidence links',
              passed: false,
              evidencePaths: ['/tmp/qa/flow.png'],
              assertions: [
                {
                  name: 'Primary button position',
                  passed: false,
                  expected: 'Button is visible',
                  actual: 'Button is hidden',
                  evidencePath: '/tmp/qa/assertion.png',
                },
              ],
            },
          ],
        },
      ],
    });

    const openButtons = screen.getAllByRole('button', { name: /open/i });
    fireEvent.click(openButtons[0]);
    fireEvent.click(openButtons[1]);

    expect(invoke).toHaveBeenCalledWith('feature-qa:open-evidence', {
      threadId: 'thread-1',
      path: '/tmp/qa/assertion.png',
    });
    expect(invoke).toHaveBeenCalledWith('feature-qa:open-evidence', {
      threadId: 'thread-1',
      path: '/tmp/qa/flow.png',
    });
  });

  it('does not open QA evidence when the active thread is missing', () => {
    const invoke = vi.fn(async () => null);
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      activeThreadId: null,
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

    expect(invoke).not.toHaveBeenCalledWith('feature-qa:open-evidence', expect.anything());
  });

  it('renders evidence open errors from QA result links', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'feature-qa:open-evidence') throw new Error('evidence missing');
      return null;
    });
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      qaResults: [
        {
          featureId: 'issue-42',
          status: 'failed',
          summary: 'Visual QA failed.',
          runAt: new Date().toISOString(),
          evidencePaths: ['/tmp/qa/missing.png'],
          flowResults: [],
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /open/i }));

    expect(await screen.findByText('evidence missing')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /http:\/\/localhost:4321/i }));
    expect(invoke).toHaveBeenCalledWith('shell:open-external', {
      url: 'http://localhost:4321',
    });
  });

  it('keeps manual QA disabled when there is no active thread', () => {
    renderPipelineTab({
      activeThreadId: null,
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

    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('falls back to no manual QA server when lookup fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'feature-qa:get-server') throw new Error('lookup failed');
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

    expect(
      await screen.findByText(/starts the configured runtime qa command/i),
    ).toBeInTheDocument();
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

  it('renders a clamped error when stopping manual QA fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'feature-qa:get-server') {
        return { baseUrl: 'http://localhost:5174', port: 5174 };
      }
      if (channel === 'feature-qa:stop-server') {
        throw new Error('stop failed');
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

    expect(await screen.findByText('http://localhost:5174')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('stop failed')).toBeInTheDocument();
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

  it('opens task graph issue links from the active issue URL', () => {
    const invoke = vi.fn(async () => null);
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderPipelineTab({
      taskGraph: {
        id: 'graph-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        mode: 'github-subissues',
        status: 'active',
        riskScore: 0.7,
        assessment: {
          mode: 'github-subissues',
          shouldDecompose: true,
          riskScore: 0.7,
          reasons: ['multi-surface'],
          suggestedNodeCount: 1,
          surfaces: ['frontend'],
        },
        nodes: [
          {
            id: 'node-1',
            graphId: 'graph-1',
            stableKey: 'step-1',
            order: 1,
            title: 'Update settings form',
            description: 'Wire the settings form.',
            status: 'ready',
            files: ['apps/desktop/src/renderer/settings.tsx'],
            acceptanceCriteria: ['Settings save'],
            surfaces: ['frontend'],
            agentRole: 'frontend',
            suggestedExecutorModel: 'claude',
            suggestedReasoningEffort: 'high',
            githubIssueNumber: 99,
            startedAt: null,
            completedAt: null,
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T10:00:00.000Z',
          },
        ],
        edges: [],
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-05-01T10:00:00.000Z',
      },
      githubIssueUrl: 'https://github.com/acme/repo/issues/42?focused=1',
    });

    fireEvent.click(screen.getByTitle('Open task issue #99'));

    expect(invoke).toHaveBeenCalledWith('shell:open-external', {
      url: 'https://github.com/acme/repo/issues/99',
    });
  });

  it('renders editable OpenRouter slug controls and reports blur changes', () => {
    const onPhaseOpenRouterSlugBlur = vi.fn();

    renderPipelineTab({
      executorEditable: true,
      currentPhaseSelections: {
        planner: { provider: 'openrouter', modelId: 'custom/current-model' },
        reviewer: { provider: 'codex', modelId: null },
        executor: { provider: 'claude', modelId: null },
        verifier: { provider: 'claude', modelId: null },
      },
      phaseSelectValues: {
        planner: 'openrouter::custom/current-model',
        reviewer: '__inherit__',
        executor: '__inherit__',
        verifier: '__inherit__',
      },
      phaseModelValidation: {
        planner: {
          modelId: 'custom/current-model',
          status: 'invalid',
          message: 'Model slug could not be validated.',
        },
      },
      integrationStatus: {
        openrouter: {
          authStatus: 'missing',
          message: 'OpenRouter key is missing.',
        },
      } as unknown as IntegrationStatus,
      onPhaseOpenRouterSlugBlur,
    });

    expect(screen.getByText('OpenRouter key is missing.')).toBeInTheDocument();
    expect(screen.getByText('Model slug could not be validated.')).toBeInTheDocument();

    fireEvent.blur(screen.getByPlaceholderText('e.g. anthropic/claude-sonnet-4.6'), {
      target: { value: 'anthropic/claude-sonnet-4.6' },
    });

    expect(onPhaseOpenRouterSlugBlur).toHaveBeenCalledWith(
      'planner',
      'anthropic/claude-sonnet-4.6',
    );
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
      onStabilizePr,
    });

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
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Comment' }));

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
      refName: null,
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
