import {
  deriveGithubIssueUrl,
  type GitHubIssueCacheRecord,
  type PlanRecord,
  type Thread,
} from '@shipcode/shared';
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
});

const makeThread = (overrides: Partial<Thread> = {}): Thread => {
  const base: Thread = {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread title',
    prompt: 'Do the thing',
    status: 'awaiting_approval',
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    executorModel: 'claude',
    verifierModel: 'claude',
    reviewRound: 0,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: null,
    forkPointSha: null,
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: null,
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
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on;

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

    expect(screen.getByText('Spec body')).toBeInTheDocument();
    expect(screen.getByText('first item')).toBeInTheDocument();
    expect(screen.getByText('Start pipeline')).toBeInTheDocument();
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
          plannerMaxTurns: 3,
          maxReviewRounds: 2,
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
          openrouterEnabled: false,
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
          plannerMaxTurns: 3,
          maxReviewRounds: 2,
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
          openrouterEnabled: false,
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

    const agentsTab = screen.getByRole('tab', { name: 'Agents' });
    fireEvent.mouseDown(agentsTab, { button: 0 });
    fireEvent.click(agentsTab);
    await waitFor(() => {
      expect(agentsTab).toHaveAttribute('data-state', 'active');
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

  it('renders Plan and Agents tab triggers', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    expect(screen.getByRole('tab', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agents' })).toBeInTheDocument();
  });

  it('Plan tab is active by default and shows PRD content', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    const planTab = screen.getByRole('tab', { name: 'Plan' });
    expect(planTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('Spec body')).toBeInTheDocument();
  });

  it('Agents tab starts inactive and Plan tab starts active', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveAttribute('data-state', 'inactive');
  });

  it('pipeline start card is above the tab bar when pipeline not started', async () => {
    invokeMock.mockResolvedValue([]);

    renderWithProviders();

    const startButton = screen.getByRole('button', { name: 'Start pipeline' });
    const planTab = screen.getByRole('tab', { name: 'Plan' });
    // Start button should appear before the tab list in the DOM
    expect(startButton.compareDocumentPosition(planTab)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
