// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { AppSettings, Project, ProjectSetupDraft } from '@shipcode/shared';
import { TooltipProvider } from '@shipcode/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';
import { AssistantPanel } from './AssistantPanel';

vi.mock('../stores/toast-store', () => ({
  toast: {
    error: vi.fn(),
  },
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AssistantPanel />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const settings = {
  prdRewriteClaudeModel: 'claude-sonnet-4-6',
  prdRewriteCodexModel: 'gpt-5.4-mini',
} as AppSettings;

const project = {
  id: 'project-1',
  name: 'ShipCode',
  path: '/repo',
  githubRepoFullName: 'shipshitdev/shipcode',
  githubProjectUrl: 'https://github.com/users/decod3rs/projects/1',
} as Project;

const setupDraft = {
  inspection: {
    status: 'configured',
    path: '/repo/.shipcode/setup.json',
    contract: null,
    error: null,
  },
  profiles: [],
  suggestedContract: {
    version: 1,
    setupCommands: [],
    verifyCommands: ['bun test'],
    envFiles: [],
    setupBeforeVerify: false,
    testingContext: null,
  },
} as ProjectSetupDraft;

describe('AssistantPanel', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeProjectId: 'project-1',
      activeIssue: null,
      assistantCli: 'claude',
      assistantDraft: '',
      assistantQueuedPrompt: null,
      assistantThreadId: null,
      canonicalTerminalStream: {},
      assistantUserMessages: [],
    });
    window.shipcode = {
      invoke: vi.fn(),
      on: vi.fn(() => () => {}),
    };
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return settings;
      if (channel === 'project:get') return project;
      if (channel === 'project:get-setup') return setupDraft;
      if (channel === 'terminal:list') return [];
      if (channel === 'instant:shell-start') return { threadId: 'assistant-thread-1' };
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('fills suggested prompts into the draft box', async () => {
    renderWithProviders();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Review this project setup and tell me what is missing.',
      }),
    );

    expect(screen.getByPlaceholderText('Ask about setup, issues, or the board...')).toHaveValue(
      'Review this project setup and tell me what is missing.',
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Look at the Kanban board and suggest what I should run next.',
      }),
    );
    expect(screen.getByPlaceholderText('Ask about setup, issues, or the board...')).toHaveValue(
      'Look at the Kanban board and suggest what I should run next.',
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Help me turn this idea into GitHub issues.',
      }),
    );
    expect(screen.getByPlaceholderText('Ask about setup, issues, or the board...')).toHaveValue(
      'Help me turn this idea into GitHub issues.',
    );
  });

  it('shows a toast instead of starting when no project is selected', async () => {
    useAppStore.setState({
      activeProjectId: null,
      assistantDraft: 'Review setup',
    });

    renderWithProviders();

    fireEvent.keyDown(screen.getByPlaceholderText('Ask about setup, issues, or the board...'), {
      key: 'Enter',
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Select a project before starting an assistant thread',
    );
    expect(invokeMock).not.toHaveBeenCalledWith('instant:shell-start', expect.anything());
  });

  it('starts a persistent assistant shell thread on first send', async () => {
    renderWithProviders();

    fireEvent.change(screen.getByPlaceholderText('Ask about setup, issues, or the board...'), {
      target: { value: 'Review setup' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'instant:shell-start',
        expect.objectContaining({
          projectId: 'project-1',
          cli: 'claude',
          reasoningEffort: 'medium',
          initialPrompt: expect.stringContaining('User request:\nReview setup'),
        }),
      );
    });
  });

  it('includes rich setup, active issue context, and Codex model settings in new threads', async () => {
    useAppStore.setState({
      assistantCli: 'codex',
      viewMode: 'project',
      projectTab: 'git',
      activeIssue: {
        issueNumber: 42,
        title: 'Tighten setup checks',
      },
    } as never);
    const richSetup = {
      ...setupDraft,
      inspection: {
        ...setupDraft.inspection,
        contract: {
          version: 1,
          setupCommands: ['bun install', 'bun db:migrate'],
          verifyCommands: ['bun test', 'bun typecheck'],
          envFiles: [],
          setupBeforeVerify: true,
          testingContext: 'Run desktop tests with thread pool.',
        },
      },
      profiles: [
        {
          kind: 'bun',
          label: 'Bun',
          recommended: true,
          evidence: ['bun.lock'],
          suggestedContract: setupDraft.suggestedContract,
        },
        {
          kind: 'npm',
          label: 'Electron',
          recommended: false,
          evidence: ['package.json'],
          suggestedContract: setupDraft.suggestedContract,
        },
      ],
    } as ProjectSetupDraft;
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return settings;
      if (channel === 'project:get') return project;
      if (channel === 'project:get-setup') return richSetup;
      if (channel === 'terminal:list') return [];
      if (channel === 'instant:shell-start') return { threadId: 'assistant-thread-rich' };
      return undefined;
    });

    renderWithProviders();

    fireEvent.change(screen.getByPlaceholderText('Ask about setup, issues, or the board...'), {
      target: { value: 'Review the current setup context' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'instant:shell-start',
        expect.objectContaining({
          cli: 'codex',
          modelId: null,
          initialPrompt: expect.stringContaining('Active issue: Tighten setup checks'),
        }),
      );
    });
    const startCall = invokeMock.mock.calls.find(([channel]) => channel === 'instant:shell-start');
    const initialPrompt = (startCall?.[1] as { initialPrompt: string }).initialPrompt;
    expect(initialPrompt).toContain('Setup commands: bun install && bun db:migrate');
    expect(initialPrompt).toContain('Verify commands: bun test && bun typecheck');
    expect(initialPrompt).toContain('Setup before verify: yes');
    expect(initialPrompt).toContain('Testing context: Run desktop tests with thread pool.');
    expect(initialPrompt).toContain('Detected profiles: Bun (recommended), Electron');
    expect(await screen.findByText(/Tighten setup checks/)).toBeInTheDocument();
  });

  it('shows a toast when starting a new assistant thread fails', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return settings;
      if (channel === 'project:get') return project;
      if (channel === 'project:get-setup') return setupDraft;
      if (channel === 'terminal:list') return [];
      if (channel === 'instant:shell-start') throw new Error('assistant unavailable');
      return undefined;
    });

    renderWithProviders();

    fireEvent.change(screen.getByPlaceholderText('Ask about setup, issues, or the board...'), {
      target: { value: 'Start and fail' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Assistant failed', 'assistant unavailable');
    });
  });

  it('runs a queued assistant prompt and clears it', async () => {
    useAppStore.setState({
      assistantQueuedPrompt: 'Queued setup review',
    });

    renderWithProviders();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'instant:shell-start',
        expect.objectContaining({
          initialPrompt: expect.stringContaining('User request:\nQueued setup review'),
        }),
      );
    });
    expect(useAppStore.getState().assistantQueuedPrompt).toBeNull();
  });

  it('falls back to fetching project and null setup context when starting a new thread', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return settings;
      if (channel === 'project:get') return project;
      if (channel === 'project:get-setup') throw new Error('setup missing');
      if (channel === 'terminal:list') return [];
      if (channel === 'instant:shell-start') return { threadId: 'assistant-thread-2' };
      return undefined;
    });

    renderWithProviders();

    fireEvent.change(screen.getByPlaceholderText('Ask about setup, issues, or the board...'), {
      target: { value: 'Review without setup' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'instant:shell-start',
        expect.objectContaining({
          modelId: null,
          initialPrompt: expect.stringContaining('Setup contract: not loaded.'),
        }),
      );
    });
  });

  it('keeps running threads in stop mode instead of sending follow-up prompts', async () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      canonicalTerminalStream: {
        'assistant-thread-1': [
          {
            id: 'event-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:00.000Z',
            event: { kind: 'lifecycle', message: 'Claude CLI process started' },
          },
        ],
      },
    });

    renderWithProviders();

    fireEvent.change(screen.getByPlaceholderText('Ask about setup, issues, or the board...'), {
      target: { value: 'Now create the issue draft' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Ask about setup, issues, or the board...'), {
      key: 'Enter',
    });

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('instant:shell-input', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('instant:shell-start', expect.anything());
  });

  it('stops a running assistant and starts a fresh thread when requested', async () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      canonicalTerminalStream: {
        'assistant-thread-1': [
          {
            id: 'event-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:00.000Z',
            event: { kind: 'lifecycle', message: 'Claude CLI process started' },
          },
        ],
      },
    });

    renderWithProviders();

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByTitle('New assistant thread'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:cancel', {
        threadId: 'assistant-thread-1',
      });
    });
    expect(useAppStore.getState().assistantThreadId).toBeNull();
  });

  it('shows an animated thinking state and replaces Send with Stop while running', async () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      canonicalTerminalStream: {
        'assistant-thread-1': [
          {
            id: 'event-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:00.000Z',
            event: { kind: 'lifecycle', message: 'Claude CLI process started' },
          },
        ],
      },
    });

    renderWithProviders();

    expect(await screen.findByLabelText('Thinking')).toBeInTheDocument();
    expect(screen.getByText('T')).toHaveClass('assistant-thinking-letter');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('does not expose assistant threads as raw terminal sessions', async () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      canonicalTerminalStream: {
        'assistant-thread-1': [
          {
            id: 'event-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:00.000Z',
            event: { kind: 'lifecycle', message: 'Claude CLI process exited (code 0)' },
          },
        ],
      },
    } as never);

    renderWithProviders();

    await screen.findByText('ShipCode Assistant');
    expect(screen.queryByRole('button', { name: 'Raw' })).not.toBeInTheDocument();
  });

  it('hydrates an empty assistant transcript from terminal history', async () => {
    const hydrateCanonicalEvents = vi.fn();
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      hydrateCanonicalEvents,
      canonicalTerminalStream: {},
    } as never);
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return settings;
      if (channel === 'project:get') return project;
      if (channel === 'project:get-setup') return setupDraft;
      if (channel === 'terminal:list') {
        return [
          {
            id: 'event-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:01.000Z',
            event: { kind: 'text', content: 'Hydrated output' },
          },
        ];
      }
      return undefined;
    });

    renderWithProviders();

    await waitFor(() => {
      expect(hydrateCanonicalEvents).toHaveBeenCalledWith('assistant-thread-1', [
        {
          id: 'event-1',
          threadId: 'assistant-thread-1',
          createdAt: '2026-05-09T00:00:01.000Z',
          event: { kind: 'text', content: 'Hydrated output' },
        },
      ]);
    });
  });

  it('renders the assistant thread as conversation turns', async () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      assistantUserMessages: [
        {
          id: 'user-1',
          threadId: 'assistant-thread-1',
          content: 'What changed?',
          createdAt: '2026-05-09T00:00:00.000Z',
        },
      ],
      canonicalTerminalStream: {
        'assistant-thread-1': [
          {
            id: 'event-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:01.000Z',
            event: { kind: 'text', content: 'The co-pilot rail is ready.' },
          },
        ],
      },
    });

    renderWithProviders();

    expect(await screen.findByText('What changed?')).toBeInTheDocument();
    expect(screen.getByText('The co-pilot rail is ready.')).toBeInTheDocument();
  });

  it('shows raw assistant activity as fallback conversation steps', async () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      assistantUserMessages: [
        {
          id: 'user-1',
          threadId: 'assistant-thread-1',
          content: 'Run setup review',
          createdAt: '2026-05-09T00:00:00.000Z',
        },
      ],
      canonicalTerminalStream: {
        'assistant-thread-1': [
          {
            id: 'raw-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:01.000Z',
            event: {
              kind: 'raw',
              content:
                '\u001b[2m19:54:30\u001b[0m\nFetch project board items\ncommand gh project item-list\nDo you want to proceed?',
            },
          },
          {
            id: 'tool-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:02.000Z',
            event: { kind: 'tool_start', name: 'read', summary: 'Reading setup files' },
          },
          {
            id: 'text-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:03.000Z',
            event: { kind: 'text', content: 'Setup is configured.' },
          },
        ],
      },
    });

    renderWithProviders();

    expect(await screen.findByText('Setup is configured.')).toBeInTheDocument();
    expect(screen.getByText('Fetch project board items')).toBeInTheDocument();
    expect(screen.getByText('command gh project item-list')).toBeInTheDocument();
    expect(screen.getByText('Do you want to proceed?')).toBeInTheDocument();
  });

  it('summarizes assistant thinking, completed tools, failures, and errors', async () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      assistantUserMessages: [],
      canonicalTerminalStream: {
        'assistant-thread-1': [
          {
            id: 'thinking-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:01.000Z',
            event: { kind: 'thinking', content: '\u001b[2mChecking setup\u001b[0m' },
          },
          {
            id: 'tool-start-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:02.000Z',
            event: { kind: 'tool_start', name: 'shell', summary: 'bun test' },
          },
          {
            id: 'tool-end-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:03.000Z',
            event: { kind: 'tool_end', name: 'shell', exitCode: 1 },
          },
          {
            id: 'error-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:04.000Z',
            event: { kind: 'error', message: 'failed' },
          },
        ],
      },
    });

    renderWithProviders();

    expect(await screen.findByText('Tools: 1 (1 failed)')).toBeInTheDocument();
    expect(screen.getByText('Errors: 1')).toBeInTheDocument();
    expect(screen.getAllByText('Thinking: Checking setup').length).toBeGreaterThan(0);
  });

  it('renders thinking, tool calls, and errors inline in the timeline', async () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      assistantUserMessages: [],
      canonicalTerminalStream: {
        'assistant-thread-1': [
          {
            id: 'thinking-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:01.000Z',
            event: { kind: 'thinking', content: 'Analyzing the project structure to find config' },
          },
          {
            id: 'tool-start-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:02.000Z',
            event: { kind: 'tool_start', name: 'read', summary: 'package.json' },
          },
          {
            id: 'tool-end-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:03.000Z',
            event: { kind: 'tool_end', name: 'read', durationMs: 1200, exitCode: 0 },
          },
          {
            id: 'error-1',
            threadId: 'assistant-thread-1',
            createdAt: '2026-05-09T00:00:04.000Z',
            event: { kind: 'error', message: 'Rate limit exceeded' },
          },
        ],
      },
    });

    renderWithProviders();

    const thinkingMatches = await screen.findAllByText(/Thinking: Analyzing the project/);
    expect(thinkingMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();
    expect(screen.getByText('1.2s')).toBeInTheDocument();
    expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument();
  });
});
