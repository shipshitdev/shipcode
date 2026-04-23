// @vitest-environment jsdom

import type { PlanRecord } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { CommandPalette } from './CommandPalette';

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
      <CommandPalette />
    </QueryClientProvider>,
  );
}

describe('CommandPalette', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    class MockResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on;

    useAppStore.setState({
      commandPaletteOpen: true,
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      pipelinePhase: 'awaiting_approval',
      activeIssue: null,
      githubIssues: [],
    } as never);
  });

  afterEach(() => {
    cleanup();
    if (originalResizeObserver) {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: originalScrollIntoView,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('replaces approval actions with waiting-for-slot state after approval', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:list-visible') return [];
      if (channel === 'plan:list') {
        return [
          {
            id: 'plan-1',
            threadId: 'thread-1',
            version: 1,
            rawOutput: '',
            structured: null,
            status: 'approved',
            createdAt: new Date().toISOString(),
          },
        ] satisfies PlanRecord[];
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Waiting for execution slot')).toBeInTheDocument();
    expect(screen.queryByText('Approve Plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject Plan')).not.toBeInTheDocument();
  });

  it('keeps approval actions visible while the plan still needs a decision', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:list-visible') return [];
      if (channel === 'plan:list') {
        return [
          {
            id: 'plan-1',
            threadId: 'thread-1',
            version: 1,
            rawOutput: '',
            structured: null,
            status: 'awaiting_approval',
            createdAt: new Date().toISOString(),
          },
        ] satisfies PlanRecord[];
      }
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Approve Plan')).toBeInTheDocument();
    expect(screen.getByText('Reject Plan')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for execution slot')).not.toBeInTheDocument();
  });
});
