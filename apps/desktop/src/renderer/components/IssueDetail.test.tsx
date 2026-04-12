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
  executorModel: 'claude',
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

    // The Confirm button should be disabled because structured is null (canApprove is false)
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmButton).toBeDisabled();
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
