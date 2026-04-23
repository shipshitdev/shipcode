import { useMemo, useState } from 'react';
import type { ProjectIssueGraph } from '@shipcode/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Loader2,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Background,
  type Connection,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAppStore } from '../../stores/app-store';
import { IssueGraphNode } from './issue-graph-node';
import { buildIssueFlowGraph, formatPreviewGroups } from './issue-graph-utils';

const nodeTypes = { issueGraphNode: IssueGraphNode };

export function ProjectGraphTab() {
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

  const refreshGraph = (nextGraph: ProjectIssueGraph) => {
    queryClient.setQueryData(['issue-graph', activeProjectId], nextGraph);
  };

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
      window.shipcode.invoke<{ issueOrder: string[]; groups: string[][] }>('issue-graph:preview-run', {
        projectId: activeProjectId,
        selectedIssueIds: issueIds,
      }),
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

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    const issue = graph?.nodes.find((entry) => entry.issueId === node.id);
    if (!issue) return;
    const cachedIssue = useAppStore.getState().githubIssues.find((entry) => entry.id === issue.issueId);
    if (!cachedIssue) return;
    selectIssue(cachedIssue);
    if (useAppStore.getState().issueDetailCollapsed) {
      useAppStore.getState().toggleIssueDetail();
    }
  };

  if (!activeProjectId) {
    return <div className="flex flex-1 items-center justify-center text-sm text-secondary">Select a project to view its issue graph.</div>;
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
    return <div className="flex flex-1 items-center justify-center text-sm text-secondary">No issue graph available.</div>;
  }

  return (
    <div className="grid flex-1 min-h-0 min-w-0 gap-4 bg-primary px-4 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="min-h-[520px] min-w-0 overflow-hidden">
        <CardContent className="h-full min-h-[520px] p-0">
          <ReactFlow
            nodes={flowGraph.nodes}
            edges={flowGraph.edges}
            nodeTypes={nodeTypes}
            fitView
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            onNodeClick={handleNodeClick}
            onSelectionChange={({ nodes }) => {
              setSelectedIssueIds(nodes.map((node) => node.id));
            }}
            onConnect={(connection: Connection) => {
              if (!connection.source || !connection.target) return;
              createEdge.mutate({
                sourceIssueId: connection.source,
                targetIssueId: connection.target,
              });
            }}
            onEdgesDelete={(edges) => {
              for (const edge of edges) {
                deleteEdge.mutate(edge.id);
              }
            }}
          >
            <MiniMap pannable zoomable />
            <Controls />
            <Background gap={16} size={1} />
          </ReactFlow>
        </CardContent>
      </Card>

      <Card className="min-h-0">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle>Grouped Run</CardTitle>
            <Badge variant="info">{selectedIssueIds.length} selected</Badge>
          </div>
          <div className="text-xs text-secondary">
            Drag to lasso-select issues, connect nodes to add a local `blocks` edge, and delete edges with Backspace.
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            className="w-full"
            disabled={selectedIssueIds.length === 0 || previewRun.isPending}
            onClick={() => previewRun.mutate(selectedIssueIds)}
          >
            Preview Execution Order
          </Button>

          {previewError ? (
            <Alert variant="destructive">
              <AlertDescription>{previewError}</AlertDescription>
            </Alert>
          ) : null}

          {previewGroups.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-secondary">Preview</div>
              <div className="space-y-2">
                {formatPreviewGroups(graph, previewGroups).map((line) => (
                  <div key={line} className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-primary">
                    {line}
                  </div>
                ))}
              </div>
              <Button
                className="w-full"
                disabled={confirmRun.isPending}
                onClick={() => confirmRun.mutate()}
              >
                Start Grouped Run
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-secondary">
              Preview order appears here before dispatch.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
