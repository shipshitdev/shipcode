// @vitest-environment jsdom

import {
  deriveGithubIssueUrl,
  type GitHubIssueCacheRecord,
  type PlanRecord,
  type ReviewRecord,
  type Thread,
  type VerificationRecord,
} from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { IssueDetail } from './IssueDetail';

const makeIssue = (overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord => ({
  id: 'issue-1',
  projectId: 'project-1',
  issueNumber: 42,
  title: 'Issue title',
  body: '## Spec body\n\n- first item',
  labels: ['agent:claude'],
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
  priorityRank: null,
  priorityRaw: null,
  priorityFetchedAt: null,
  isQuickMode: false,
  ...overrides,
});

const makeThread = (overrides: Partial<Thread> = {}): Thread => {
  const base: Thread = {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread title',
    prompt: 'Do the thing',
    status: 'awaiting_approval',
    kind: 'pipeline' as const,
    worktreeBranch: null,
    worktreePath: null,
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
    autonomous: false,
    baseBranch: null,
    forkPointSha: null,
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: null,
    automationId: null,
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
    lastError: null,
    failurePhase: null,
    failureCount: 0,
  };
  return { ...base, ...overrides };
};

const makePlan = (overrides: Partial<PlanRecord> = {}): PlanRecord => ({
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  rawOutput: '',
  status: 'pending_review',
  createdAt: new Date().toISOString(),
  structured: {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    objective: 'Implement issue detail controls',
    files: [
      {
        path: 'apps/desktop/src/renderer/components/IssueDetail.tsx',
        action: 'modify',
        description: 'Update issue detail',
      },
    ],
    steps: [
      {
        order: 1,
        description: 'Render issue actions',
        files: ['apps/desktop/src/renderer/components/IssueDetail.tsx'],
        rationale: 'Needed for approve/reject flow',
      },
    ],
    acceptanceCriteria: ['Users can approve or reject from the issue panel'],
    outOfScope: [],
    estimatedComplexity: 'medium',
    dependencies: [],
  },
  ...overrides,
});

const makeReview = (overrides: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id: 'review-1',
  planId: 'plan-1',
  decision: 'request_changes',
  confidence: 'high',
  rawOutput: '',
  structured: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const makeVerification = (overrides: Partial<VerificationRecord> = {}): VerificationRecord => ({
  id: 'verification-1',
  threadId: 'thread-1',
  planId: 'plan-1',
  rawOutput: 'raw',
  structured: {
    threadId: 'thread-1',
    planId: 'plan-1',
    result: 'failed',
    summary: 'Needs changes',
    criteriaResults: [],
    issues: [{ severity: 'blocker', description: 'Fix it' }],
  },
  result: 'failed',
  retryCount: 0,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const makeProject = () => ({
  id: 'project-1',
  name: 'Project',
  path: '/tmp/project',
  gitRemote: 'https://github.com/acme/repo.git',
  githubRepoId: null,
  githubRepoFullName: null,
  starterIssueNumber: null,
  starterIssueCreatedAt: null,
  githubProjectUrl: null,
  plannerModelOverride: null,
  reviewerModelOverride: null,
  executorModelOverride: 'codex',
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
  defaultBranch: 'main',
  pinned: false,
  archived: false,
  hidden: false,
  notifyGithubUser: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <IssueDetail />
    </QueryClientProvider>,
  );
}

describe('IssueDetail', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    window.shipcode = {
      invoke: invokeMock as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: null,
      activeIssue: makeIssue(),
      sidebarCollapsed: false,
      terminalVisible: false,
      settingsVisible: false,
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
      agentOutputs: {},
      commandPaletteOpen: false,
      createIssueModalOpen: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders issue body as markdown', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    const prdTab = screen.getByRole('tab', { name: 'Issue' });
    fireEvent.mouseDown(prdTab, { button: 0 });
    fireEvent.click(prdTab);
    await waitFor(() => {
      expect(prdTab).toHaveAttribute('data-state', 'active');
    });
    expect(screen.getByText('Issue brief')).toBeInTheDocument();
    expect(screen.getByText('GitHub issue #42 source content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh issue from GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit issue body' })).toBeInTheDocument();
    expect(screen.getByText('Spec body')).toBeInTheDocument();
    expect(screen.getByText('first item')).toBeInTheDocument();
    expect(screen.getByText('Start pipeline')).toBeInTheDocument();
  });

  it('renders linked PR controls in the issue header and opens the PR URL', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'shell:open-external') return undefined;
      return [];
    });

    useAppStore.setState({
      activeIssue: makeIssue({
        pipelineStatus: 'completed',
        linkedPrNumber: 17,
        linkedPrUrl: 'https://github.com/acme/repo/pull/17',
        linkedPrIsDraft: true,
      }),
    });

    renderWithProviders();

    const prButton = await screen.findByRole('button', { name: /PR #17/i });
    expect(screen.getByText('Draft PR')).toBeInTheDocument();

    fireEvent.click(prButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: 'https://github.com/acme/repo/pull/17',
      });
    });
  });

  it('makes the issue id clickable, removes the standalone GitHub button, and hides start CTA for completed PR work', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'shell:open-external') return undefined;
      return [];
    });

    useAppStore.setState({
      activeIssue: makeIssue({
        pipelineStatus: 'completed',
        linkedPrNumber: 17,
        linkedPrUrl: 'https://github.com/acme/repo/pull/17',
        linkedPrIsDraft: true,
      }),
    });

    renderWithProviders();

    expect(screen.queryByText('View on GitHub')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start pipeline' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: '#42' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('shell:open-external', {
        url: deriveGithubIssueUrl('https://github.com/acme/repo.git', 42),
      });
    });
  });

  it('starts pipeline from an unclaimed issue', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'github:start-issue') return undefined;
      if (channel === 'thread') return null;
      return [];
    });

    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: 'Start pipeline' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:start-issue', {
        projectId: 'project-1',
        issueNumber: 42,
      });
    });
  });

  it('retries a failed threaded issue through pipeline:retry instead of starting a new issue run', async () => {
    const thread = makeThread({ status: 'failed' });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'failed' }),
      pipelinePhase: 'failed',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:retry') return undefined;
      if (channel === 'github:list-issues')
        return [makeIssue({ threadId: thread.id, pipelineStatus: 'failed' })];
      if (channel === 'thread:list') return [thread];
      return args ?? null;
    });

    renderWithProviders();
    fireEvent.click(await screen.findByRole('button', { name: 'Re-plan' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:retry', { threadId: thread.id });
    });
    expect(invokeMock).not.toHaveBeenCalledWith('github:start-issue', {
      projectId: 'project-1',
      issueNumber: 42,
    });
  });

  it('surfaces execution retry copy when the latest verification failed with structured findings', async () => {
    const thread = makeThread({
      status: 'failed',
      worktreePath: '/tmp/project',
      worktreeBranch: 'ship/42-test',
    });
    const verification = makeVerification();

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'failed' }),
      pipelinePhase: 'failed',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [makePlan({ status: 'approved' })];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'verification:get') return verification;
      if (channel === 'pipeline:retry') return undefined;
      if (channel === 'github:list-issues')
        return [makeIssue({ threadId: thread.id, pipelineStatus: 'failed' })];
      if (channel === 'thread:list') return [thread];
      return args ?? null;
    });

    renderWithProviders();

    expect(await screen.findByRole('button', { name: 'Resume execution' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume verification' })).not.toBeInTheDocument();
  });

  it('renders clarification questions and resumes planning with submitted answers', async () => {
    const thread = makeThread({
      status: 'clarifying',
      clarificationRequest: {
        id: 'clarify-1',
        threadId: 'thread-1',
        phase: 'plan',
        summary: 'Need one decision before planning.',
        questions: [
          {
            id: 'scope',
            title: 'Scope',
            prompt: 'Which scope should ShipCode plan for?',
            description: null,
            choices: [
              { id: 'narrow', label: 'Narrow', description: 'Ship the smallest useful change.' },
              { id: 'wide', label: 'Wide', description: 'Include adjacent cleanup too.' },
            ],
            allowFreeform: false,
            freeformPlaceholder: null,
          },
        ],
      },
    });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'clarifying' }),
      pipelinePhase: 'clarifying',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:answer-clarification') return undefined;
      return args ?? null;
    });

    renderWithProviders();

    expect(await screen.findByText('Answer these before planning continues')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Wide/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume planning' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:answer-clarification', {
        threadId: thread.id,
        answers: [{ questionId: 'scope', selectedChoiceId: 'wide', freeformText: null }],
      });
    });
  });

  it('renders clarification content inside the issue detail scroll region', async () => {
    const thread = makeThread({
      status: 'clarifying',
      clarificationRequest: {
        id: 'clarify-2',
        threadId: 'thread-1',
        phase: 'plan',
        summary: 'Need routing confirmation.',
        questions: [
          {
            id: 'surface',
            title: 'Public Surface',
            prompt: 'Which app should host the public route?',
            description: 'This changes the file list and deployment target.',
            choices: [
              {
                id: 'app',
                label: 'apps/app',
                description: 'Keep delivery in the product surface.',
              },
            ],
            allowFreeform: false,
            freeformPlaceholder: null,
          },
        ],
      },
    });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'clarifying' }),
      pipelinePhase: 'clarifying',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [];
      if (channel === 'review:list-by-plans') return {};
      return args ?? null;
    });

    const { container } = renderWithProviders();

    const clarificationHeading = await screen.findByText('Answer these before planning continues');
    const scrollRegion = container.querySelector('[data-issue-detail-scroll-region]');

    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion?.contains(clarificationHeading)).toBe(true);
  });

  it('shows only the submitted clarification answers after planning resumes', async () => {
    const thread = makeThread({
      status: 'planning',
      answeredClarification: {
        request: {
          id: 'clarify-3',
          threadId: 'thread-1',
          phase: 'plan',
          summary: 'Need one decision before planning.',
          questions: [
            {
              id: 'scope',
              title: 'Scope',
              prompt: 'Which scope should ShipCode plan for?',
              description: null,
              choices: [
                { id: 'narrow', label: 'Narrow', description: 'Ship the smallest useful change.' },
                { id: 'wide', label: 'Wide', description: 'Include adjacent cleanup too.' },
              ],
              allowFreeform: true,
              freeformPlaceholder: null,
            },
          ],
        },
        answers: [
          {
            questionId: 'scope',
            selectedChoiceId: 'wide',
            freeformText: 'Include the auth migration too.',
          },
        ],
      },
    });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'planning' }),
      pipelinePhase: 'planning',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'project:get') return makeProject();
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [];
      if (channel === 'review:list-by-plans') return {};
      return args ?? null;
    });

    renderWithProviders();

    expect(await screen.findByText('Planning resumed with your answers')).toBeInTheDocument();
    expect(screen.getByText('Wide')).toBeInTheDocument();
    expect(screen.getByText('Include the auth migration too.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume planning' })).not.toBeInTheDocument();
    expect(screen.queryByText('Answer these before planning continues')).not.toBeInTheDocument();
  });

  it('approves the plan when the dropdown defaults to Approve & Execute', async () => {
    const thread = makeThread();
    const plan = makePlan();

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
      pipelinePhase: 'awaiting_approval',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'project:get')
        return {
          id: 'project-1',
          name: 'Project',
          path: '/tmp/project',
          gitRemote: 'git@github.com:shipshitdev/shipcode.git',
          githubProjectUrl: null,
          plannerModelOverride: null,
          reviewerModelOverride: null,
          executorModelOverride: 'codex',
          verifierModelOverride: null,
          plannerModelIdOverride: null,
          reviewerModelIdOverride: null,
          executorModelIdOverride: null,
          verifierModelIdOverride: null,
          plannerReasoningEffortOverride: null,
          reviewerReasoningEffortOverride: null,
          executorReasoningEffortOverride: null,
          verifierReasoningEffortOverride: null,
          defaultBranch: 'main',
          pinned: false,
          archived: false,
          hidden: false,
          notifyGithubUser: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      if (channel === 'settings:get')
        return {
          theme: 'system',
          defaultWorktreeEnabled: true,
          terminalScrollback: 10000,
          plannerModel: 'claude',
          reviewerModel: 'codex',
          verifierModel: 'claude',
          executorModel: 'claude',
          githubPollingEnabled: false,
          githubPollingIntervalMs: 30000,
          githubBotUsername: '',
          autoPickupEnabled: false,
          statusLabelMappings: {},
          onboardingVersion: 1,
          projectSortOrder: 'recent',
          worktreeRoot: null,
          worktreeBranchFormat: 'ship/{id}-{slug}',
          revisionCount: 2,
          requireApproval: false,
          plannerReasoningEffort: 'high',
          reviewerReasoningEffort: 'high',
          executorReasoningEffort: 'high',
          verifierReasoningEffort: 'high',
          notificationsEnabled: true,
          notificationOsEnabled: true,
          notificationBadgeEnabled: true,
          notificationSoundEnabled: false,
          notificationEvents: {
            awaitingApproval: true,
            failed: true,
            completed: true,
            verificationExhausted: true,
            ciBlocked: true,
          },
          openrouterPlannerModel: null,
          openrouterReviewerModel: null,
          openrouterVerifierModel: null,
          openrouterExecutorModel: null,
          openrouterDefaultPaidModel: 'openrouter/auto',
          openrouterDefaultFreeModel: 'openrouter/free',
          openrouterExplicitFallback: 'openrouter/auto',
          testCommand: null,
          testingContext: null,
          maxConcurrentPipelines: 1,
        };
      if (channel === 'plan:list') return [plan];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:approve') return undefined;
      if (channel === 'pipeline:reject') return undefined;
      if (channel === 'github:refresh-issues') return [];
      if (channel === 'github:list-issues')
        return [makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' })];
      if (channel === 'thread:list') return [thread];
      return args ?? null;
    });

    renderWithProviders();

    // Default dropdown state is 'approve', so the Confirm button approves
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:approve', { threadId: thread.id });
    });
  });

  it('renders the approval section even when plan has no structured data', async () => {
    const thread = makeThread();
    const plan = makePlan({ structured: null, rawOutput: 'raw fallback' });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
      pipelinePhase: 'awaiting_approval',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [plan];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:cancel') return undefined;
      return args ?? null;
    });

    renderWithProviders();

    // With rawOutput present, approval is allowed even when structured is null
    // (the rawOutput fallback path from pipeline:approve parses it server-side)
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmButton).toBeEnabled();
  });

  it('renders the approval dropdown when awaiting approval', async () => {
    const thread = makeThread();
    const plan = makePlan();

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
      pipelinePhase: 'awaiting_approval',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [plan];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:cancel') return undefined;
      return args ?? null;
    });

    renderWithProviders();

    // Approval section is present — the dropdown trigger is a combobox
    // and the Confirm button is visible when defaulting to 'approve'
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmButton).toBeInTheDocument();
  });

  it('shows a clear approval error when the approve action races with a queued execution state', async () => {
    const thread = makeThread();
    const plan = makePlan();

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'awaiting_approval' }),
      pipelinePhase: 'awaiting_approval',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [plan];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:approve') {
        throw new Error('Approval is already confirmed. Waiting for an execution slot.');
      }
      return args ?? null;
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText(/Approval is already confirmed\. Waiting for an execution slot\./),
    ).toBeInTheDocument();
  });

  it('shows waiting-for-execution messaging after a plan is already approved', async () => {
    const thread = makeThread({ status: 'awaiting_approval' });
    const plan = makePlan({ status: 'approved' });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'awaiting_approval' }),
      pipelinePhase: 'awaiting_approval',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [plan];
      if (channel === 'review:list-by-plans') return {};
      if (channel === 'pipeline:cancel') return undefined;
      return args ?? null;
    });

    renderWithProviders();

    expect(await screen.findByText('Waiting For Execution Slot')).toBeInTheDocument();
    expect(screen.getByText(/Approval is already confirmed\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('renders plan history with human-readable labels instead of raw status enums', async () => {
    const thread = makeThread({ status: 'reviewing' });
    const latestPlan = makePlan();
    const oldPlan = makePlan({
      id: 'plan-0',
      version: 0,
      status: 'superseded',
    });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
      pipelinePhase: 'reviewing',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [latestPlan, oldPlan];
      if (channel === 'review:list-by-plans') return {};
      return args ?? null;
    });

    renderWithProviders();
    const historyTab = screen.getByRole('tab', { name: /Plans/ });
    fireEvent.mouseDown(historyTab, { button: 0 });
    fireEvent.click(historyTab);
    await waitFor(() => {
      expect(historyTab).toHaveAttribute('data-state', 'active');
    });

    expect(await screen.findByText('Superseded')).toBeInTheDocument();
    expect(screen.queryByText('pending_review')).not.toBeInTheDocument();
  });

  it('does not load issue-wide history until View all runs is clicked', async () => {
    const thread = makeThread({ status: 'reviewing' });
    const currentPlan = makePlan();
    const olderPlan = makePlan({
      id: 'plan-0',
      threadId: 'thread-older',
      version: 1,
      status: 'superseded',
    });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
      pipelinePhase: 'reviewing',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [currentPlan];
      if (channel === 'plan:list-for-issue') return [currentPlan, olderPlan];
      if (channel === 'review:list-by-plans') return {};
      return args ?? [];
    });

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Issue' })).toHaveAttribute('data-state', 'active');
    });
    expect(invokeMock).not.toHaveBeenCalledWith('plan:list-for-issue', {
      projectId: 'project-1',
      issueNumber: 42,
    });

    const historyTab = screen.getByRole('tab', { name: /Plans/ });
    fireEvent.mouseDown(historyTab, { button: 0 });
    fireEvent.click(historyTab);

    await waitFor(() => {
      expect(historyTab).toHaveAttribute('data-state', 'active');
    });
    expect(invokeMock).not.toHaveBeenCalledWith('plan:list-for-issue', {
      projectId: 'project-1',
      issueNumber: 42,
    });

    fireEvent.click(screen.getByRole('button', { name: 'View all runs' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('plan:list-for-issue', {
        projectId: 'project-1',
        issueNumber: 42,
      });
    });
    expect(await screen.findByRole('button', { name: 'Latest run only' })).toBeInTheDocument();
  });

  it('renders reviewer feedback labels without leaking raw decision enums', async () => {
    const thread = makeThread({ status: 'awaiting_approval' });
    const plan = makePlan({ status: 'awaiting_approval' });
    const review = makeReview({ planId: plan.id, decision: 'request_changes' });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
      pipelinePhase: 'awaiting_approval',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [plan];
      if (channel === 'review:list-by-plans') return { [plan.id]: review };
      return args ?? null;
    });

    renderWithProviders();
    const historyTab = screen.getByRole('tab', { name: /Plans/ });
    fireEvent.mouseDown(historyTab, { button: 0 });
    fireEvent.click(historyTab);
    await waitFor(() => {
      expect(historyTab).toHaveAttribute('data-state', 'active');
    });

    expect(await screen.findByText('Needs approval')).toBeInTheDocument();
    expect(screen.queryByText('Changes requested')).not.toBeInTheDocument();
    expect(screen.queryByText('request_changes')).not.toBeInTheDocument();
  });

  it('renders a single resolved status for approved plans even if review data conflicts', async () => {
    const thread = makeThread({ status: 'completed' });
    const plan = makePlan({ status: 'approved' });
    const review = makeReview({ planId: plan.id, decision: 'request_changes' });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'completed' }),
      pipelinePhase: 'completed',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [plan];
      if (channel === 'review:list-by-plans') return { [plan.id]: review };
      return args ?? null;
    });

    renderWithProviders();
    const historyTab = screen.getByRole('tab', { name: /Plans/ });
    fireEvent.mouseDown(historyTab, { button: 0 });
    fireEvent.click(historyTab);
    await waitFor(() => {
      expect(historyTab).toHaveAttribute('data-state', 'active');
    });

    expect(await screen.findByText('AI approved')).toBeInTheDocument();
    expect(screen.queryByText('Changes requested')).not.toBeInTheDocument();
  });

  it('lazy-loads malformed issue-history plans and hides raw planner transcript spam', async () => {
    const thread = makeThread({ status: 'reviewing' });
    const currentThreadPlan = makePlan({
      id: 'plan-history-1',
      threadId: thread.id,
      structured: null,
      rawOutput: '',
    });
    const malformedPlan = makePlan({
      id: currentThreadPlan.id,
      threadId: thread.id,
      structured: null,
      rawOutput: [
        'Producing the execution contract for Issue #48.',
        "$ /bin/zsh -lc 'pwd && rg --files .'",
        '```shipcode-plan',
        '{ not valid json',
        '```',
      ].join('\n'),
    });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
      pipelinePhase: 'reviewing',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [currentThreadPlan];
      if (channel === 'plan:get-by-id') return malformedPlan;
      if (channel === 'review:list-by-plans') return {};
      return args ?? null;
    });

    renderWithProviders();

    const historyTab = await screen.findByRole('tab', { name: /Plans/ });
    fireEvent.mouseDown(historyTab, { button: 0 });
    fireEvent.click(historyTab);

    await waitFor(() => {
      expect(historyTab).toHaveAttribute('data-state', 'active');
    });

    fireEvent.click(screen.getByText('v1'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('plan:get-by-id', { planId: currentThreadPlan.id });
    });

    expect(await screen.findByText('Structured plan unavailable')).toBeInTheDocument();
    expect(screen.getByText(/fence found but content is not valid JSON/i)).toBeInTheDocument();
    expect(screen.queryByText(/\/bin\/zsh -lc/)).not.toBeInTheDocument();
  });

  it('sets a planner codex override from the issue detail panel', async () => {
    const thread = makeThread({ status: 'failed' });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({
        threadId: thread.id,
        pipelineStatus: 'failed',
        plannerModelOverride: null,
      }),
      pipelinePhase: 'failed',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'project:list')
        return [
          {
            id: 'project-1',
            name: 'Project',
            path: '/tmp/project',
            gitRemote: 'git@github.com:shipshitdev/shipcode.git',
            githubProjectUrl: null,
            plannerModelOverride: null,
            reviewerModelOverride: null,
            executorModelOverride: 'codex',
            verifierModelOverride: null,
            plannerModelIdOverride: null,
            reviewerModelIdOverride: null,
            executorModelIdOverride: null,
            verifierModelIdOverride: null,
            plannerReasoningEffortOverride: null,
            reviewerReasoningEffortOverride: null,
            executorReasoningEffortOverride: null,
            verifierReasoningEffortOverride: null,
            defaultBranch: 'main',
            pinned: false,
            archived: false,
            hidden: false,
            notifyGithubUser: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
      if (channel === 'settings:get')
        return {
          theme: 'system',
          defaultWorktreeEnabled: true,
          terminalScrollback: 10000,
          plannerModel: 'claude',
          reviewerModel: 'codex',
          verifierModel: 'claude',
          executorModel: 'claude',
          githubPollingEnabled: false,
          githubPollingIntervalMs: 30000,
          githubBotUsername: '',
          autoPickupEnabled: false,
          statusLabelMappings: {},
          onboardingVersion: 1,
          projectSortOrder: 'recent',
          worktreeRoot: null,
          worktreeBranchFormat: 'ship/{id}-{slug}',
          revisionCount: 2,
          requireApproval: false,
          plannerReasoningEffort: 'high',
          reviewerReasoningEffort: 'high',
          executorReasoningEffort: 'high',
          verifierReasoningEffort: 'high',
          notificationsEnabled: true,
          notificationOsEnabled: true,
          notificationBadgeEnabled: true,
          notificationSoundEnabled: false,
          notificationEvents: {
            awaitingApproval: true,
            failed: true,
            completed: true,
            verificationExhausted: true,
            ciBlocked: true,
          },
          openrouterPlannerModel: null,
          openrouterReviewerModel: null,
          openrouterVerifierModel: null,
          openrouterExecutorModel: null,
          openrouterDefaultPaidModel: 'openrouter/auto',
          openrouterDefaultFreeModel: 'openrouter/free',
          openrouterExplicitFallback: 'openrouter/auto',
          testCommand: null,
          testingContext: null,
          maxConcurrentPipelines: 1,
        };
      if (channel === 'github:set-phase-model-override') return undefined;
      if (channel === 'github:set-phase-model-id-override') return undefined;
      return args ?? [];
    });

    renderWithProviders();

    const pipelineTab = screen.getByRole('tab', { name: 'Pipeline' });
    fireEvent.mouseDown(pipelineTab, { button: 0 });
    fireEvent.click(pipelineTab);
    await waitFor(() => {
      expect(pipelineTab).toHaveAttribute('data-state', 'active');
    });

    const plannerTrigger = (await screen.findAllByRole('combobox'))[0];
    fireEvent.click(plannerTrigger);
    fireEvent.click(await screen.findByText('GPT-5.4'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:set-phase-model-override', {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        model: 'codex',
      });
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:set-phase-model-id-override', {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        modelId: 'gpt-5.4',
      });
    });
  });

  it('renders the shared issue detail tab triggers', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    expect(screen.getByRole('tab', { name: 'Issue' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plans' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument();
  });

  it('Issue tab is active by default when no plan history exists', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    const prdTab = screen.getByRole('tab', { name: 'Issue' });
    expect(prdTab).toHaveAttribute('data-state', 'active');
  });

  it('keeps a stable tab order and defaults to Issue even when history exists', async () => {
    const thread = makeThread({ status: 'reviewing' });
    const plan = makePlan();

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
      pipelinePhase: 'reviewing',
    });

    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [plan];
      if (channel === 'review:list-by-plans') return {};
      return args ?? [];
    });

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Issue' })).toHaveAttribute('data-state', 'active');
    });

    const tabLabels = screen.getAllByRole('tab').map((tab) => tab.textContent?.trim());
    expect(tabLabels).toEqual(['Issue', 'Comments', 'Plans', 'Pipeline', 'Activity', 'Conversations', 'Costs']);
  });

  it('pipeline start card is above the tab bar when pipeline not started', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    const startButton = screen.getByRole('button', { name: 'Start pipeline' });
    const prdTab = screen.getByRole('tab', { name: 'Issue' });
    // Start button should appear before the tab list in the DOM
    expect(startButton.compareDocumentPosition(prdTab)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('back button closes issue detail and returns to board', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: 'Back to board' }));
    expect(useAppStore.getState().activeIssue).toBeNull();
  });

  it('does not auto-dismiss notifications when opening a thread', async () => {
    const thread = makeThread({ status: 'failed' });

    useAppStore.setState({
      activeThreadId: thread.id,
      activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'failed' }),
      pipelinePhase: 'failed',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread:get') return thread;
      if (channel === 'plan:list') return [];
      if (channel === 'review:list-by-plans') return {};
      return [];
    });

    renderWithProviders();

    await screen.findByText('Issue title');
    await waitFor(() => {
      expect(invokeMock).not.toHaveBeenCalledWith('notification:dismiss', expect.anything());
    });
  });

  it('copies the formatted issue branch name to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return { worktreeBranchFormat: 'ship/{id}-{slug}' };
      return [];
    });

    useAppStore.setState({
      activeIssue: makeIssue({ issueNumber: 42, title: 'Issue title' }),
    });

    renderWithProviders();

    const copyButton = await screen.findByTestId('copy-branch-name');
    expect(copyButton).toHaveAttribute('title', 'Copy branch name (ship/42-issue-title)');

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('ship/42-issue-title');
    });
    await waitFor(() => {
      expect(screen.getByTestId('copy-branch-name')).toHaveAttribute('title', 'Copied!');
    });
  });

  it('honors a custom worktreeBranchFormat from settings when copying the branch name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return { worktreeBranchFormat: 'feat/{id}-{slug}' };
      return [];
    });

    useAppStore.setState({
      activeIssue: makeIssue({ issueNumber: 7, title: 'Add foo bar' }),
    });

    renderWithProviders();

    const copyButton = await screen.findByTestId('copy-branch-name');
    await waitFor(() => {
      expect(screen.getByTestId('copy-branch-name')).toHaveAttribute(
        'title',
        'Copy branch name (feat/7-add-foo-bar)',
      );
    });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('feat/7-add-foo-bar');
    });
  });
});

describe('deriveGithubIssueUrl', () => {
  it('handles ssh:// scheme with .git suffix', () => {
    expect(deriveGithubIssueUrl('ssh://git@github.com/owner/repo.git', 42)).toBe(
      'https://github.com/owner/repo/issues/42',
    );
  });

  it('handles ssh:// scheme without .git suffix', () => {
    expect(deriveGithubIssueUrl('ssh://git@github.com/owner/repo', 7)).toBe(
      'https://github.com/owner/repo/issues/7',
    );
  });

  it('handles scp-style remotes (git@github.com:owner/repo.git)', () => {
    expect(deriveGithubIssueUrl('git@github.com:owner/repo.git', 1)).toBe(
      'https://github.com/owner/repo/issues/1',
    );
  });

  it('handles https remotes with and without .git', () => {
    expect(deriveGithubIssueUrl('https://github.com/owner/repo.git', 5)).toBe(
      'https://github.com/owner/repo/issues/5',
    );
    expect(deriveGithubIssueUrl('https://github.com/owner/repo', 6)).toBe(
      'https://github.com/owner/repo/issues/6',
    );
  });

  it('is case-insensitive for the host', () => {
    expect(deriveGithubIssueUrl('https://GITHUB.COM/owner/repo', 9)).toBe(
      'https://github.com/owner/repo/issues/9',
    );
    expect(deriveGithubIssueUrl('git@GITHUB.COM:owner/repo.git', 10)).toBe(
      'https://github.com/owner/repo/issues/10',
    );
  });

  it('returns null for non-github hosts', () => {
    expect(deriveGithubIssueUrl('git@gitlab.com:owner/repo.git', 1)).toBeNull();
    expect(deriveGithubIssueUrl('https://gitlab.com/owner/repo', 1)).toBeNull();
    expect(deriveGithubIssueUrl('ssh://git@bitbucket.org/owner/repo.git', 1)).toBeNull();
  });

  it('returns null for empty or nullish remotes', () => {
    expect(deriveGithubIssueUrl(null, 1)).toBeNull();
    expect(deriveGithubIssueUrl(undefined, 1)).toBeNull();
    expect(deriveGithubIssueUrl('', 1)).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(deriveGithubIssueUrl('  git@github.com:owner/repo.git  ', 2)).toBe(
      'https://github.com/owner/repo/issues/2',
    );
  });
});

describe('IssueDetail — quick mode hides GitHub UI', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return makeProject();
      return [];
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    window.shipcode = {
      invoke: invokeMock as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: null,
      activeIssue: makeIssue({ issueNumber: -1, isQuickMode: true }),
      sidebarCollapsed: false,
      terminalVisible: false,
      settingsVisible: false,
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
      agentOutputs: {},
      commandPaletteOpen: false,
      createIssueModalOpen: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows "Quick" chip instead of #-1 and hides GitHub open button', async () => {
    renderWithProviders();

    expect(await screen.findByText('Quick')).toBeInTheDocument();
    expect(screen.queryByText(/^#-1$/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /open this issue on github/i }),
    ).not.toBeInTheDocument();
  });

  it('does not render Comments tab for quick tasks', async () => {
    renderWithProviders();

    await screen.findByText('Quick');
    expect(screen.queryByRole('tab', { name: /comments/i })).not.toBeInTheDocument();
  });
});
