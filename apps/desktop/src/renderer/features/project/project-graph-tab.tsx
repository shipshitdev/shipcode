import type { ProjectIssueGraph } from '@shipcode/shared';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, cn } from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type NodeMouseHandler,
  ReactFlow,
  SelectionMode,
} from '@xyflow/react';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { useAppStore } from '../../stores/app-store';
import { IssueGraphNode } from './issue-graph-node';
import { buildIssueFlowGraph, formatPreviewGroups } from './issue-graph-utils';

const nodeTypes = { issueGraphNode: IssueGraphNode };
const deleteKeyCode = ['Backspace', 'Delete'];

function sameSelectedIssueIds(previous: string[], next: string[]) {
  return (
    previous.length === next.length && previous.every((issueId, index) => issueId === next[index])
  );
}

export function ProjectGraphTab({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [previewGroups, setPreviewGroups] = useState<string[][]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { data: graph, isLoading } = useQuery<ProjectIssueGraph>({
    queryKey: ['issue-graph', activeProjectId],
    queryFn: () => window.shipcode.invoke('issue-graph:get', { projectId: activeProjectId }),
    enabled: !!activeProjectId,
    staleTime: 5_000,
  });

  const flowGraph = useMemo(
    () => (graph ? buildIssueFlowGraph(graph) : { nodes: [], edges: [] as Edge[] }),
    [graph],
  );

  useEffect(() => {
    if (!activeProjectId) return;
    return window.shipcode.on('github:issues-updated', ({ projectId }) => {
      if (projectId !== activeProjectId) return;
      void queryClient.invalidateQueries({ queryKey: ['issue-graph', activeProjectId] });
    });
  }, [activeProjectId, queryClient]);

  const refreshGraph = useCallback(
    (nextGraph: ProjectIssueGraph) => {
      queryClient.setQueryData(['issue-graph', activeProjectId], nextGraph);
    },
    [activeProjectId, queryClient],
  );

  const createEdge = useMutation({
    mutationFn: (input: { sourceIssueId: string; targetIssueId: string }) =>
      window.shipcode.invoke<ProjectIssueGraph>('issue-graph:create-edge', {
        projectId: activeProjectId,
        sourceIssueId: input.sourceIssueId,
        targetIssueId: input.targetIssueId,
        edgeType: 'blocks',
      }),
    onSuccess: refreshGraph,
  });

  const deleteEdge = useMutation({
    mutationFn: (edgeId: string) =>
      window.shipcode.invoke<ProjectIssueGraph>('issue-graph:delete-edge', {
        projectId: activeProjectId,
        edgeId,
      }),
    onSuccess: refreshGraph,
  });

  const previewRun = useMutation({
    mutationFn: (issueIds: string[]) =>
      window.shipcode.invoke<{ issueOrder: string[]; groups: string[][] }>(
        'issue-graph:preview-run',
        {
          projectId: activeProjectId,
          selectedIssueIds: issueIds,
        },
      ),
    onSuccess: (preview) => {
      setPreviewGroups(preview.groups);
      setPreviewError(null);
    },
    onError: (error) => {
      setPreviewGroups([]);
      setPreviewError(error instanceof Error ? error.message : String(error));
    },
  });

  const confirmRun = useMutation({
    mutationFn: () =>
      window.shipcode.invoke('issue-graph:confirm-run', {
        projectId: activeProjectId,
        selectedIssueIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ['issue-graph', activeProjectId] });
    },
  });

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const issue = graph?.nodes.find((entry) => entry.issueId === node.id);
      if (!issue) return;
      const cachedIssue = useAppStore
        .getState()
        .githubIssues.find((entry) => entry.id === issue.issueId);
      if (!cachedIssue) return;
      selectIssue(cachedIssue);
    },
    [graph, selectIssue],
  );

  const handleSelectionChange = useCallback(({ nodes }: { nodes: Array<{ id: string }> }) => {
    const nextIssueIds = nodes.map((node) => node.id);
    setSelectedIssueIds((previous) =>
      sameSelectedIssueIds(previous, nextIssueIds) ? previous : nextIssueIds,
    );
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      createEdge.mutate({
        sourceIssueId: connection.source,
        targetIssueId: connection.target,
      });
    },
    [createEdge.mutate],
  );

  const handleEdgesDelete = useCallback(
    (edges: Edge[]) => {
      for (const edge of edges) {
        deleteEdge.mutate(edge.id);
      }
    },
    [deleteEdge.mutate],
  );

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-secondary">
        Select a project to view its issue graph.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-secondary">
        <Loader2 className="animate-spin" size={14} />
        Loading graph…
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-secondary">
        No issue graph available.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-1 min-h-0 min-w-0 bg-primary',
        embedded ? 'h-full p-3' : 'px-4 py-4',
      )}
    >
      <Card className="min-h-[520px] min-w-0 flex-1 overflow-hidden bg-primary">
        <CardContent className="relative h-full min-h-[520px] p-0">
          {selectedIssueIds.length > 0 || previewGroups.length > 0 || previewError ? (
            <div className="pointer-events-none absolute right-3 top-3 z-10 w-[min(360px,calc(100%-24px))]">
              <div className="pointer-events-auto rounded-md border border-border bg-secondary/95 p-3 shadow-lg shadow-black/30 backdrop-blur">
                <div className="flex items-center gap-2">
                  <Badge variant="info">{selectedIssueIds.length} selected</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto"
                    disabled={selectedIssueIds.length === 0 || previewRun.isPending}
                    onClick={() => previewRun.mutate(selectedIssueIds)}
                  >
                    Preview order
                  </Button>
                </div>

                {previewError ? (
                  <Alert variant="destructive" className="mt-3">
                    <AlertDescription>{previewError}</AlertDescription>
                  </Alert>
                ) : null}

                {previewGroups.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                      {formatPreviewGroups(graph, previewGroups).map((line) => (
                        <div
                          key={line}
                          className="rounded-md border border-border bg-primary px-2.5 py-2 text-xs text-primary"
                        >
                          {line}
                        </div>
                      ))}
                    </div>
                    <Button
                      className="w-full"
                      disabled={confirmRun.isPending}
                      onClick={() => confirmRun.mutate()}
                    >
                      Start grouped run
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <ReactFlow
            className="shipcode-issue-graph"
            nodes={flowGraph.nodes}
            edges={flowGraph.edges}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            deleteKeyCode={deleteKeyCode}
            onNodeClick={handleNodeClick}
            onSelectionChange={handleSelectionChange}
            onConnect={handleConnect}
            onEdgesDelete={handleEdgesDelete}
          >
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(5, 6, 7, 0.68)"
              nodeColor="var(--bg-elevated)"
              nodeStrokeColor="var(--border-strong)"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            />
            <Controls />
            <Background
              color="rgba(244, 244, 245, 0.26)"
              bgColor="var(--bg-primary)"
              gap={20}
              size={1}
            />
          </ReactFlow>
        </CardContent>
      </Card>
    </div>
  );
}
