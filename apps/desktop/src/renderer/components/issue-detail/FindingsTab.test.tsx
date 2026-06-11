// @vitest-environment jsdom

import type { ReviewFindingRecord } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindingsTab } from './FindingsTab';

function makeFinding(overrides: Partial<ReviewFindingRecord> = {}): ReviewFindingRecord {
  return {
    id: 'finding-1',
    projectId: 'project-1',
    threadId: 'thread-1',
    planId: 'plan-1',
    reviewId: null,
    verificationId: 'verification-1',
    runId: null,
    phase: 'verify',
    source: 'verification',
    severity: 'blocker',
    status: 'open',
    title: 'Typecheck failed',
    description: 'Fix the TypeScript error',
    suggestion: 'Run bun run typecheck',
    filePath: 'src/app.ts',
    fingerprint: 'abc',
    sourceModel: 'claude',
    commitSha: null,
    prNumber: null,
    worktreePath: null,
    branch: null,
    metadata: null,
    resolvedByRunId: null,
    resolvedAt: null,
    createdAt: '2026-05-31T08:00:00.000Z',
    updatedAt: '2026-05-31T08:00:00.000Z',
    ...overrides,
  };
}

function renderWithClient(findings: ReviewFindingRecord[], threadId: string | null = 'thread-1') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FindingsTab threadId={threadId} findings={findings} />
    </QueryClientProvider>,
  );
}

describe('FindingsTab', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders recorded findings and status actions', async () => {
    invokeMock.mockResolvedValue(makeFinding({ status: 'ignored' }));

    renderWithClient([makeFinding()]);

    expect(screen.getByText('1 open / 1 total')).toBeInTheDocument();
    expect(screen.getByText('Typecheck failed')).toBeInTheDocument();
    expect(screen.getByText('src/app.ts')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ignore/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('review-findings:update-status', {
        findingId: 'finding-1',
        status: 'ignored',
      }),
    );
  });

  it('renders empty states', () => {
    renderWithClient([], null);
    expect(screen.getByText('No pipeline run is linked yet.')).toBeInTheDocument();

    cleanup();

    renderWithClient([]);
    expect(screen.getByText('No review findings recorded.')).toBeInTheDocument();
  });
});
