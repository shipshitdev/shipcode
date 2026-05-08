// @vitest-environment jsdom

import type { AppSettings, NotificationRecord } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { NotificationToaster } from './NotificationToaster';

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
      <NotificationToaster />
    </QueryClientProvider>,
  );
}

function makeNotification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'notification-1',
    threadId: 'thread-1',
    projectId: 'project-1',
    kind: 'completed',
    title: 'Build complete',
    body: 'Verification passed.',
    createdAt: '2026-04-16T00:00:00.000Z',
    dismissedAt: null,
    ...overrides,
  };
}

describe('NotificationToaster', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  const playMock = vi.fn<() => Promise<void>>().mockResolvedValue();
  const audioCtorMock = vi.fn();

  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
    invokeMock.mockReset();
    playMock.mockClear();
    audioCtorMock.mockClear();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    class MockAudio {
      volume = 1;

      constructor() {
        audioCtorMock();
      }

      play() {
        return playMock();
      }
    }

    vi.stubGlobal('Audio', MockAudio);

    useAppStore.setState({
      activeProjectId: null,
      activeThreadId: null,
      viewMode: 'overview',
      notifications: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays a sound for new notifications and routes clicks into project context', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      notificationSoundEnabled: true,
    };
    const notification = makeNotification();

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return settings;
      if (channel === 'notification:dismiss') return undefined;
      return null;
    });

    useAppStore.setState({
      notifications: [notification],
    });

    renderWithProviders();

    expect(await screen.findByText('Build complete')).toBeInTheDocument();
    expect(screen.getByTestId('notification-toaster')).toHaveClass(
      'right-4',
      'top-[calc(var(--spacing-titlebar)+0.75rem)]',
    );
    await waitFor(() => {
      expect(audioCtorMock).toHaveBeenCalledTimes(1);
      expect(playMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /Build complete/i }));

    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.activeProjectId).toBe('project-1');
      expect(state.activeThreadId).toBe('thread-1');
      expect(state.viewMode).toBe('project');
      expect(state.notifications).toEqual([]);
    });
  });

  it('dismisses sticky notifications manually and auto-hides non-sticky ones', async () => {
    vi.useFakeTimers();

    const sticky = makeNotification({
      id: 'sticky-1',
      kind: 'awaiting_approval',
      title: 'Approval needed',
      body: 'Review required before execution.',
    });
    const transient = makeNotification({
      id: 'transient-1',
      kind: 'failed',
      title: 'Build failed',
      body: 'Typecheck failed.',
    });

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'notification:dismiss') return undefined;
      return null;
    });

    useAppStore.setState({
      notifications: [sticky, transient],
    });

    renderWithProviders();

    expect(screen.getByText('Approval needed')).toBeInTheDocument();
    expect(screen.getByText('Build failed')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(220);
    });

    expect(screen.queryByText('Build failed')).not.toBeInTheDocument();
    expect(screen.getByText('Approval needed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await act(async () => {
      vi.advanceTimersByTime(220);
    });

    expect(window.shipcode.invoke).toHaveBeenCalledWith('notification:dismiss', {
      id: 'sticky-1',
    });
    expect(useAppStore.getState().notifications).toEqual([]);
  });
});
