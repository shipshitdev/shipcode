// @vitest-environment jsdom

import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { InstantFixModal } from './InstantFixModal';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InstantFixModal />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('InstantFixModal', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();

    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible') {
        return [{ id: 'project-1', name: 'ShipCode', path: '/tmp/shipcode' }];
      }
      if (channel === 'settings:get') {
        return DEFAULT_SETTINGS;
      }
      if (channel === 'instant:shell-start') {
        return { threadId: 'thread-live' };
      }
      return null;
    });

    useAppStore.setState({
      activeProjectId: 'project-1',
      instantFixModalOpen: true,
      instantPaneThreadIds: [],
      instantPaneMetaByThread: {},
      projectTab: 'issues',
      viewMode: 'project',
      activeIssue: null,
      activeThreadId: null,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    } as never);
  });

  it('starts a shell when pressing cmd-enter from the prompt field', async () => {
    renderWithProviders();

    const startButton = await screen.findByRole('button', { name: /start shell/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());

    const textarea = screen.getByPlaceholderText(/optional initial prompt for the live shell/i);
    fireEvent.change(textarea, { target: { value: 'Inspect the failing tests' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:shell-start', {
        projectId: 'project-1',
        cli: 'claude',
        modelId: null,
        reasoningEffort: 'high',
        initialPrompt: 'Inspect the failing tests',
        attachmentSessionId: undefined,
      });
    });

    expect(useAppStore.getState().instantPaneThreadIds).toEqual(['thread-live']);
    expect(useAppStore.getState().instantPaneMetaByThread['thread-live']).toEqual({
      mode: 'live',
      cli: 'claude',
      title: 'Claude • Inspect the failing tests',
      state: 'running',
    });
    expect(useAppStore.getState().projectTab).toBe('sessions');
  });
});
