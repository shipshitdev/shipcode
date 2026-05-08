// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type {
  CodeFileContent,
  CodeTreeEntry,
  DiffRecord,
  GitVisualizerData,
  GitWorktreeSummary,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { CodeBrowser } from './code-browser';

vi.mock('@shipcode/ui', () => ({
  SideBySideDiffViewer: ({ diffs }: { diffs: DiffRecord[] }) => (
    <div data-testid="diff-viewer">{diffs[0]?.filePath}</div>
  ),
  SyntaxHighlightedCode: ({ code, filePath }: { code: string; filePath: string }) => (
    <pre data-testid="syntax-code" data-file-path={filePath}>
      {code}
    </pre>
  ),
}));

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CodeBrowser />
    </QueryClientProvider>,
  );
}

function makeWorktree(overrides: Partial<GitWorktreeSummary> = {}): GitWorktreeSummary {
  return {
    id: 'worktree-main',
    kind: 'main',
    path: '/repo',
    branch: 'main',
    commitHash: 'abc123',
    isDirty: false,
    untrackedCount: 0,
    stagedCount: 0,
    modifiedCount: 0,
    aheadCount: 0,
    behindCount: 0,
    compareRef: null,
    preCommitHookPath: null,
    threadId: null,
    issueNumber: null,
    title: null,
    status: null,
    ...overrides,
  };
}

function makeVisualizerData(worktrees = [makeWorktree()]): GitVisualizerData {
  return {
    project: { id: 'project-1', name: 'ShipCode', path: '/repo' },
    branches: ['main'],
    worktrees,
  } as unknown as GitVisualizerData;
}

function fileEntry(overrides: Partial<CodeTreeEntry> = {}): CodeTreeEntry {
  return {
    name: 'app.ts',
    relativePath: 'src/app.ts',
    type: 'file',
    sizeBytes: 120,
    isModified: false,
    ...overrides,
  };
}

function fileContent(overrides: Partial<CodeFileContent> = {}): CodeFileContent {
  return {
    relativePath: 'src/app.ts',
    content: 'export const value = 1;',
    isBinary: false,
    sizeBytes: 23,
    truncated: false,
    ...overrides,
  };
}

describe('CodeBrowser', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    useAppStore.setState({ activeProjectId: null } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the no-project state without firing IPC', () => {
    renderWithClient();

    expect(screen.getByText('Select a project to browse code.')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('loads worktrees and renders selected source and diff views', async () => {
    invokeMock.mockImplementation(async (channel: string, rawArgs?: unknown) => {
      const args = rawArgs as { relativePath?: string; worktreePath?: string } | undefined;
      if (channel === 'git:visualizer-data') return makeVisualizerData();
      if (channel === 'code:list-tree' && !args?.relativePath) {
        return [
          {
            name: 'src',
            relativePath: 'src',
            type: 'dir',
            sizeBytes: null,
            isModified: true,
          },
          fileEntry({ name: 'package.json', relativePath: 'package.json', isModified: true }),
        ];
      }
      if (channel === 'code:list-tree' && args?.relativePath === 'src') {
        return [
          fileEntry(),
          fileEntry({ name: 'styles.css', relativePath: 'src/styles.css' }),
          fileEntry({ name: 'logo.png', relativePath: 'src/logo.png' }),
          fileEntry({ name: 'script.sh', relativePath: 'src/script.sh' }),
          fileEntry({ name: 'bun.lock', relativePath: 'bun.lock' }),
        ];
      }
      if (channel === 'code:read-file') {
        return fileContent({ truncated: true, sizeBytes: 10_000 });
      }
      if (channel === 'code:file-diff') {
        return {
          id: 'diff-1',
          threadId: 'thread-1',
          filePath: 'src/app.ts',
          action: 'modify',
          diffContent: '@@ diff',
          beforeHash: null,
          afterHash: null,
          createdAt: '2026-05-08T10:00:00.000Z',
        } satisfies DiffRecord;
      }
      return null;
    });
    useAppStore.setState({ activeProjectId: 'project-1' } as never);

    renderWithClient();

    expect(await screen.findByText('main')).toBeInTheDocument();
    expect(await screen.findByText('package.json')).toBeInTheDocument();

    fireEvent.click(screen.getByText('src'));
    expect(await screen.findByText('app.ts')).toBeInTheDocument();

    fireEvent.click(screen.getByText('app.ts'));
    expect(await screen.findByTestId('syntax-code')).toHaveTextContent('export const value = 1;');
    expect(screen.getByText(/File truncated/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(await screen.findByTestId('diff-viewer')).toHaveTextContent('src/app.ts');
  });

  it('handles empty worktrees, binary files, and missing diffs', async () => {
    invokeMock.mockImplementation(async (channel: string, rawArgs?: unknown) => {
      const args = rawArgs as { relativePath?: string } | undefined;
      if (channel === 'git:visualizer-data') return makeVisualizerData([makeWorktree()]);
      if (channel === 'code:list-tree' && !args?.relativePath) {
        return [fileEntry({ name: 'logo.png', relativePath: 'logo.png' })];
      }
      if (channel === 'code:read-file') {
        return fileContent({ relativePath: 'logo.png', isBinary: true, sizeBytes: 2048 });
      }
      if (channel === 'code:file-diff') return null;
      return null;
    });
    useAppStore.setState({ activeProjectId: 'project-1' } as never);

    renderWithClient();

    fireEvent.click(await screen.findByText('logo.png'));
    expect(await screen.findByText(/Binary file/)).toHaveTextContent('2.0 KB');

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(await screen.findByText('No uncommitted changes for this file.')).toBeInTheDocument();
  });

  it('clears the selected worktree when visualizer data has no worktrees', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'git:visualizer-data') return makeVisualizerData([]);
      return [];
    });
    useAppStore.setState({ activeProjectId: 'project-1' } as never);

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText('Select a file to view its contents.')).toBeInTheDocument();
    });
    expect(screen.queryByTitle('/repo')).not.toBeInTheDocument();
  });
});
