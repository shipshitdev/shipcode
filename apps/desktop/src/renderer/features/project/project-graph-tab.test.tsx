// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { ProjectIssueGraph } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { ProjectGraphTab } from './project-graph-tab';

vi.mock('@xyflow/react', () => ({
  Background: () => <div data-testid="graph-background" />,
  Controls: () => <div data-testid="graph-controls" />,
  MiniMap: () => <div data-testid="graph-minimap" />,
  ReactFlow: ({
    children,
    edges,
    fitViewOptions,
    maxZoom,
    minZoom,
    nodes,
    onConnect,
    onEdgesDelete,
    onNodeClick,
    onSelectionChange,
  }: {
    children: ReactNode;
    edges: Array<{ id: string }>;
    fitViewOptions?: { padding: number; maxZoom: number };
    maxZoom?: number;
    minZoom?: number;
    nodes: Array<{ id: string }>;
    onConnect: (connection: { source?: string | null; target?: string | null }) => void;
    onEdgesDelete: (edges: Array<{ id: string }>) => void;
    onNodeClick: (event: unknown, node: { id: string }) => void;
    onSelectionChange: (selection: { nodes: Array<{ id: string }> }) => void;
  }) => (
    <div data-testid="react-flow">
      <div data-testid="node-count">{nodes.length}</div>
      <div data-testid="edge-count">{edges.length}</div>
      <div data-testid="zoom-limits">
        {minZoom}:{maxZoom}:{fitViewOptions?.maxZoom}
      </div>
      <button
        type="button"
        onClick={() => onSelectionChange({ nodes: [{ id: 'issue-1' }, { id: 'issue-2' }] })}
      >
        Select graph nodes
      </button>
      <button
        type="button"
        onClick={() => onSelectionChange({ nodes: [{ id: 'issue-1' }, { id: 'issue-2' }] })}
      >
        Select same nodes
      </button>
      <button type="button" onClick={() => onConnect({ source: null, target: 'issue-2' })}>
        Connect missing source
      </button>
      <button type="button" onClick={() => onConnect({ source: 'issue-1', target: 'issue-2' })}>
        Connect nodes
      </button>
      <button type="button" onClick={() => onEdgesDelete([{ id: 'edge-1' }])}>
        Delete edge
      </button>
      <button type="button" onClick={() => onNodeClick({}, { id: 'issue-1' })}>
        Open node
      </button>
      <button type="button" onClick={() => onNodeClick({}, { id: 'missing-issue' })}>
        Open missing node
      </button>
      {children}
    </div>
  ),
  SelectionMode: { Partial: 'partial' },
}));

vi.mock('./issue-graph-node', () => ({
  IssueGraphNode: () => <div data-testid="issue-graph-node" />,
}));

function renderWithClient(ui = <ProjectGraphTab />) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeGraph(): ProjectIssueGraph {
  return {
    projectId: 'project-1',
    nodes: [
      {
        issueId: 'issue-1',
        projectId: 'project-1',
        issueNumber: 1,
        title: 'First issue',
        state: 'open',
        pipelineStatus: 'planning',
        threadId: 'thread-1',
      },
      {
        issueId: 'issue-2',
        projectId: 'project-1',
        issueNumber: 2,
        title: 'Second issue',
        state: 'open',
        pipelineStatus: 'todo',
        threadId: null,
      },
    ],
    edges: [
      {
        id: 'edge-1',
        projectId: 'project-1',
        sourceIssueId: 'issue-1',
        targetIssueId: 'issue-2',
        sourceIssueNumber: 1,
        targetIssueNumber: 2,
        edgeType: 'blocks',
        origin: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

describe('ProjectGraphTab', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  const onMock = vi.fn(
    (_channel: string, _handler: (payload: { projectId: string }) => void): (() => void) =>
      () => {},
  );

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.dataset.theme = 'dark';
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    onMock.mockReturnValue(() => {});
    window.shipcode.on = onMock as unknown as typeof window.shipcode.on;
    useAppStore.setState({
      activeIssue: null,
      activeProjectId: null,
      githubIssues: [],
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the no-project and missing-graph states', async () => {
    delete document.documentElement.dataset.theme;
    renderWithClient();
    expect(screen.getByText('Select a project to view its issue graph.')).toBeInTheDocument();

    cleanup();
    invokeMock.mockResolvedValueOnce(null);
    useAppStore.setState({ activeProjectId: 'project-1' } as never);

    renderWithClient(<ProjectGraphTab embedded />);

    expect(await screen.findByText('No issue graph available.')).toBeInTheDocument();
  });

  it('previews, confirms, connects, deletes, and opens graph nodes', async () => {
    const graph = makeGraph();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'issue-graph:get') return graph;
      if (channel === 'issue-graph:preview-run') {
        return { issueOrder: ['issue-1', 'issue-2'], groups: [['issue-1'], ['issue-2']] };
      }
      if (channel === 'issue-graph:create-edge') return graph;
      if (channel === 'issue-graph:delete-edge') return graph;
      if (channel === 'issue-graph:confirm-run') return { ok: true };
      return null;
    });
    useAppStore.setState({
      activeProjectId: 'project-1',
      githubIssues: [
        {
          id: 'issue-1',
          threadId: 'thread-1',
          pipelineStatus: 'planning',
        },
      ],
    } as never);

    renderWithClient(<ProjectGraphTab embedded />);

    expect(await screen.findByTestId('react-flow')).toBeInTheDocument();
    expect(screen.getByTestId('node-count')).toHaveTextContent('2');
    expect(screen.getByTestId('edge-count')).toHaveTextContent('1');
    expect(screen.getByTestId('zoom-limits')).toHaveTextContent('0.55:1.6:1');

    fireEvent.click(screen.getByRole('button', { name: 'Select graph nodes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select same nodes' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview order' }));
    expect(await screen.findByText('Wave 1: #1 First issue')).toBeInTheDocument();
    expect(screen.getByText('Wave 2: #2 Second issue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start grouped run' }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('issue-graph:confirm-run', {
        projectId: 'project-1',
        selectedIssueIds: ['issue-1', 'issue-2'],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect missing source' }));
    expect(invokeMock).not.toHaveBeenCalledWith(
      'issue-graph:create-edge',
      expect.objectContaining({ sourceIssueId: null }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect nodes' }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('issue-graph:create-edge', {
        projectId: 'project-1',
        sourceIssueId: 'issue-1',
        targetIssueId: 'issue-2',
        edgeType: 'blocks',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete edge' }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('issue-graph:delete-edge', {
        projectId: 'project-1',
        edgeId: 'edge-1',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open node' }));
    expect(useAppStore.getState().activeIssue?.id).toBe('issue-1');

    const issueUpdatedHandler = onMock.mock.calls.find(
      ([channel]) => channel === 'github:issues-updated',
    )?.[1] as ((payload: { projectId: string }) => void) | undefined;
    issueUpdatedHandler?.({ projectId: 'other-project' });
    issueUpdatedHandler?.({ projectId: 'project-1' });
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('issue-graph:get', { projectId: 'project-1' }),
    );
  });

  it('shows preview errors and ignores missing cached issues on node clicks', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'issue-graph:get') return makeGraph();
      if (channel === 'issue-graph:preview-run') throw new Error('cycle detected');
      return null;
    });
    useAppStore.setState({ activeProjectId: 'project-1', githubIssues: [] } as never);

    renderWithClient();

    expect(await screen.findByTestId('react-flow')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select graph nodes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview order' }));
    expect(await screen.findByText('cycle detected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open node' }));
    expect(useAppStore.getState().activeIssue).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open missing node' }));
    expect(useAppStore.getState().activeIssue).toBeNull();
  });

  it('renders non-Error preview failures as strings', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'issue-graph:get') return makeGraph();
      if (channel === 'issue-graph:preview-run') throw 'preview unavailable';
      return null;
    });
    useAppStore.setState({ activeProjectId: 'project-1', githubIssues: [] } as never);

    renderWithClient();

    expect(await screen.findByTestId('react-flow')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select graph nodes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview order' }));

    expect(await screen.findByText('preview unavailable')).toBeInTheDocument();
  });
});
