// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { AppSettings, Project, ProjectSetupDraft } from '@shipcode/shared';
import { TooltipProvider } from '@shipcode/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { AssistantPanel } from './AssistantPanel';

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
    });
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
          modelId: 'claude-sonnet-4-6',
          reasoningEffort: 'medium',
          initialPrompt: expect.stringContaining('User request:\nReview setup'),
        }),
      );
    });
  });

  it('sends follow-up prompts into the existing running thread', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:shell-input', {
        threadId: 'assistant-thread-1',
        data: 'Now create the issue draft\n',
      });
    });
    expect(invokeMock).not.toHaveBeenCalledWith('instant:shell-start', expect.anything());
  });
});
