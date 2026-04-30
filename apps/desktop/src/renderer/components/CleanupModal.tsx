import type {
  CleanupAnalyzeResult,
  CleanupApplyResult,
  CleanupCriteria,
  CleanupItem,
} from '@shipcode/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Loader2,
  Modal,
  ModalFooter,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

interface CleanupModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  criteria: CleanupCriteria;
}

const KIND_LABELS: Record<CleanupItem['kind'], string> = {
  'worktree-merged-pr': 'Worktrees with merged PR',
  'worktree-closed-pr': 'Worktrees with closed PR',
  'local-branch-no-remote': 'Local branches with no remote',
  'remote-branch-merged': 'Remote branches (merged)',
};

const REMOTE_KINDS = new Set<CleanupItem['kind']>(['remote-branch-merged']);

function formatCleanupDivergence(item: CleanupItem): string | null {
  if (!('aheadCount' in item)) return null;
  const ahead = item.aheadCount ?? 0;
  const behind = item.behindCount ?? 0;
  const parts = [ahead > 0 ? `+${ahead} ahead` : null, behind > 0 ? `-${behind} behind` : null]
    .filter(Boolean)
    .join(' / ');
  if (!parts) return null;
  return `${parts}${item.compareRef ? ` vs ${item.compareRef}` : ''}`;
}

function describeItem(item: CleanupItem): { primary: string; secondary?: string } {
  const divergence = formatCleanupDivergence(item);
  switch (item.kind) {
    case 'worktree-merged-pr':
    case 'worktree-closed-pr':
      return {
        primary: `${item.branch}  ·  PR #${item.prNumber}`,
        secondary: [item.worktreePath, item.dirty ? 'LOCAL WORK' : null, divergence]
          .filter(Boolean)
          .join('  ·  '),
      };
    case 'local-branch-no-remote':
      return {
        primary: item.branch,
        secondary: [`last commit ${item.lastCommitDate}`, divergence].filter(Boolean).join('  ·  '),
      };
    case 'remote-branch-merged':
      return {
        primary: item.branch,
        secondary: `PR #${item.prNumber}`,
      };
  }
}

export function CleanupModal({ open, onClose, projectId, criteria }: CleanupModalProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acknowledgedRemote, setAcknowledgedRemote] = useState(false);
  const [applyResult, setApplyResult] = useState<CleanupApplyResult | null>(null);

  const {
    data: analysis,
    isFetching: analyzing,
    error: analyzeError,
    refetch: refetchAnalyze,
  } = useQuery<CleanupAnalyzeResult>({
    queryKey: ['cleanup-analyze', projectId, criteria],
    queryFn: () =>
      window.shipcode.invoke<CleanupAnalyzeResult>('git:cleanup-analyze', { projectId }),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setAcknowledgedRemote(false);
      setApplyResult(null);
    }
  }, [open]);

  const grouped = useMemo(() => {
    if (!analysis) return [] as Array<{ kind: CleanupItem['kind']; items: CleanupItem[] }>;
    const map = new Map<CleanupItem['kind'], CleanupItem[]>();
    for (const item of analysis.items) {
      const arr = map.get(item.kind) ?? [];
      arr.push(item);
      map.set(item.kind, arr);
    }
    return Array.from(map.entries()).map(([kind, items]) => ({ kind, items }));
  }, [analysis]);

  const hasRemoteSelection = useMemo(() => {
    if (!analysis) return false;
    for (const item of analysis.items) {
      if (selected.has(item.id) && REMOTE_KINDS.has(item.kind)) return true;
    }
    return false;
  }, [analysis, selected]);

  const apply = useMutation({
    mutationFn: () =>
      window.shipcode.invoke<CleanupApplyResult>('git:cleanup-apply', {
        projectId,
        itemIds: Array.from(selected),
      }),
    onSuccess: (result) => {
      setApplyResult(result);
      queryClient.invalidateQueries({ queryKey: ['git-visualizer-data', projectId] });
      queryClient.invalidateQueries({ queryKey: ['cleanup-analyze', projectId] });
      void refetchAnalyze();
      setSelected(new Set());
      setAcknowledgedRemote(false);
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (kind: CleanupItem['kind'], items: CleanupItem[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((it) => next.has(it.id));
      for (const it of items) {
        if (allSelected) {
          next.delete(it.id);
          continue;
        }
        const isWorktree = kind === 'worktree-merged-pr' || kind === 'worktree-closed-pr';
        const dirty = isWorktree && 'dirty' in it && it.dirty === true;
        const hasLocalCommits = 'aheadCount' in it && (it.aheadCount ?? 0) > 0;
        if (!dirty && !hasLocalCommits) next.add(it.id);
      }
      return next;
    });
  };

  const applyDisabled =
    apply.isPending || selected.size === 0 || (hasRemoteSelection && !acknowledgedRemote);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cleanup branches & worktrees"
      className="max-w-[720px] flex flex-col"
    >
      <div className="space-y-4 px-1 py-2 max-h-[60vh] overflow-y-auto">
        {analyzeError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {analyzeError instanceof Error ? analyzeError.message : 'Failed to analyze cleanup.'}
            </AlertDescription>
          </Alert>
        ) : null}

        {analyzing && !analysis ? (
          <div className="flex items-center gap-2 text-sm text-secondary">
            <Loader2 className="animate-spin" size={14} />
            Analyzing worktrees, branches & PRs…
          </div>
        ) : null}

        {analysis && analysis.items.length === 0 ? (
          <div className="text-sm text-secondary">Nothing to clean up.</div>
        ) : null}

        {analysis && analysis.protectedBranches.length > 0 ? (
          <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-secondary">
            <span className="font-semibold text-primary">Protected:</span>{' '}
            {analysis.protectedBranches.join(', ')}
          </div>
        ) : null}

        {grouped.map(({ kind, items }) => {
          const label = KIND_LABELS[kind] ?? kind;
          const isRemote = REMOTE_KINDS.has(kind);
          const allChecked = items.every((it) => selected.has(it.id));
          return (
            <section key={kind} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4
                  className={
                    isRemote
                      ? 'text-sm font-semibold text-destructive'
                      : 'text-sm font-semibold text-primary'
                  }
                >
                  {label} <span className="text-xs font-normal text-muted">({items.length})</span>
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleAll(kind, items)}
                  type="button"
                >
                  {allChecked ? 'Clear' : 'Select all'}
                </Button>
              </div>
              <ul className="space-y-1">
                {items.map((item) => {
                  const desc = describeItem(item);
                  const isWorktree =
                    item.kind === 'worktree-merged-pr' || item.kind === 'worktree-closed-pr';
                  const dirtyBlocked = isWorktree && item.dirty;
                  const localCommitsBlocked = 'aheadCount' in item && (item.aheadCount ?? 0) > 0;
                  return (
                    <li
                      key={item.id}
                      className="flex items-start gap-2 rounded-md border border-border bg-secondary/10 px-3 py-2"
                    >
                      <Checkbox
                        id={`cleanup-${item.id}`}
                        checked={selected.has(item.id)}
                        disabled={dirtyBlocked || localCommitsBlocked}
                        onCheckedChange={() => toggle(item.id)}
                        className="mt-0.5"
                      />
                      <label
                        htmlFor={`cleanup-${item.id}`}
                        className="min-w-0 flex-1 cursor-pointer text-xs"
                      >
                        <div className="truncate font-mono text-primary">{desc.primary}</div>
                        {desc.secondary ? (
                          <div
                            className={`truncate ${
                              dirtyBlocked || localCommitsBlocked
                                ? 'text-destructive'
                                : 'text-muted'
                            }`}
                          >
                            {desc.secondary}
                          </div>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {hasRemoteSelection ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <div className="text-sm font-semibold text-destructive">Remote deletion warning</div>
            <p className="mt-1 text-xs text-secondary">
              Deleting a remote branch is irreversible from the desktop app. Branch protection rules
              may still reject the push.
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs text-primary">
              <Checkbox
                checked={acknowledgedRemote}
                onCheckedChange={(checked: boolean) => setAcknowledgedRemote(!!checked)}
              />
              I understand and want to delete the selected remote branches.
            </label>
          </div>
        ) : null}

        {applyResult ? (
          <div className="space-y-2">
            {applyResult.succeeded.length > 0 ? (
              <Alert>
                <AlertDescription>
                  Removed {applyResult.succeeded.length} item
                  {applyResult.succeeded.length === 1 ? '' : 's'}.
                </AlertDescription>
              </Alert>
            ) : null}
            {applyResult.failed.length > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  <div className="text-sm font-semibold">{applyResult.failed.length} failed:</div>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                    {applyResult.failed.map((f) => (
                      <li key={f.itemId}>
                        {f.itemId}: {f.error}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {apply.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {apply.error instanceof Error ? apply.error.message : 'Cleanup failed.'}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={apply.isPending}>
          Close
        </Button>
        <Button
          onClick={() => apply.mutate()}
          disabled={applyDisabled}
          variant={hasRemoteSelection ? 'destructive' : 'default'}
        >
          {apply.isPending ? 'Applying…' : `Apply (${selected.size})`}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
