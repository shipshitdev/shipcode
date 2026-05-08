import type {
  CleanupAnalyzeResult,
  CleanupApplyResult,
  CleanupCriteria,
  CleanupItem,
} from '@shipcode/shared';
import { Alert, AlertDescription, Button, Checkbox, Modal, ModalFooter } from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
  'worktree-no-pr-clean': 'Clean merged worktrees without PR',
  'local-branch-merged': 'Local branches (merged)',
  'local-branch-no-remote': 'Local branches with no remote',
  'remote-branch-merged': 'Remote branches (merged)',
};

const REMOTE_KINDS = new Set<CleanupItem['kind']>(['remote-branch-merged']);
const WORKTREE_KINDS = new Set<CleanupItem['kind']>([
  'worktree-merged-pr',
  'worktree-closed-pr',
  'worktree-no-pr-clean',
]);
const LOCAL_BRANCH_KINDS = new Set<CleanupItem['kind']>([
  'local-branch-merged',
  'local-branch-no-remote',
]);

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
    case 'worktree-no-pr-clean':
      return {
        primary:
          'prNumber' in item && item.prNumber
            ? `${item.branch}  ·  PR #${item.prNumber}`
            : item.branch,
        secondary: [item.worktreePath, item.dirty ? 'LOCAL WORK' : null, divergence]
          .filter(Boolean)
          .join('  ·  '),
      };
    case 'local-branch-merged':
      return {
        primary: item.branch,
        secondary: [
          item.remoteBranch ? `tracks ${item.remoteBranch}` : null,
          item.prNumber ? `PR #${item.prNumber}` : null,
          `last commit ${item.lastCommitDate}`,
          divergence,
        ]
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
        primary: `${item.remote}/${item.branch}`,
        secondary: [
          item.prNumber ? `PR #${item.prNumber}` : null,
          `last commit ${item.lastCommitDate}`,
          divergence,
        ]
          .filter(Boolean)
          .join('  ·  '),
      };
  }
}

function itemHasLocalWork(item: CleanupItem): boolean {
  const dirty = WORKTREE_KINDS.has(item.kind) && 'dirty' in item && item.dirty;
  const ahead = 'aheadCount' in item && (item.aheadCount ?? 0) > 0;
  return dirty || ahead;
}

function itemHasMergeProof(item: CleanupItem): boolean {
  return !('compareRef' in item) || item.compareRef != null;
}

function isSelectableCleanupItem(item: CleanupItem): boolean {
  return !itemHasLocalWork(item) && itemHasMergeProof(item);
}

export function CleanupModal({ open, onClose, projectId, criteria }: CleanupModalProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acknowledgedCleanup, setAcknowledgedCleanup] = useState(false);
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
      setAcknowledgedCleanup(false);
      setApplyResult(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !analysis) return;
    setSelected(new Set(analysis.items.filter(isSelectableCleanupItem).map((item) => item.id)));
    setAcknowledgedCleanup(false);
  }, [analysis, open]);

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

  const selectedItems = useMemo(() => {
    if (!analysis) return [] as CleanupItem[];
    return analysis.items.filter((item) => selected.has(item.id));
  }, [analysis, selected]);

  const confirmationGroups = useMemo(() => {
    const worktrees: Array<{ branch: string; path: string }> = [];
    const localBranches: string[] = [];
    const remoteBranches: string[] = [];
    for (const item of selectedItems) {
      if (WORKTREE_KINDS.has(item.kind) && 'worktreePath' in item) {
        worktrees.push({ branch: item.branch, path: item.worktreePath });
      } else if (LOCAL_BRANCH_KINDS.has(item.kind)) {
        localBranches.push(item.branch);
      } else if (item.kind === 'remote-branch-merged') {
        remoteBranches.push(`${item.remote}/${item.branch}`);
      }
    }
    return { worktrees, localBranches, remoteBranches };
  }, [selectedItems]);

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
      setAcknowledgedCleanup(false);
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

  const toggleAll = (_kind: CleanupItem['kind'], items: CleanupItem[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((it) => next.has(it.id));
      for (const it of items) {
        if (allSelected) {
          next.delete(it.id);
          continue;
        }
        if (isSelectableCleanupItem(it)) next.add(it.id);
      }
      return next;
    });
  };

  const applyDisabled = apply.isPending || selected.size === 0 || !acknowledgedCleanup;

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
                  const blocked = !isSelectableCleanupItem(item);
                  return (
                    <li
                      key={item.id}
                      className="flex items-start gap-2 rounded-md border border-border bg-secondary/10 px-3 py-2"
                    >
                      <Checkbox
                        id={`cleanup-${item.id}`}
                        checked={selected.has(item.id)}
                        disabled={blocked}
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
                            className={`truncate ${blocked ? 'text-destructive' : 'text-muted'}`}
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

        {selectedItems.length > 0 ? (
          <div
            className={`rounded-md border p-3 ${
              hasRemoteSelection
                ? 'border-destructive/40 bg-destructive/10'
                : 'border-border bg-secondary/10'
            }`}
          >
            <div
              className={`text-sm font-semibold ${
                hasRemoteSelection ? 'text-destructive' : 'text-primary'
              }`}
            >
              Confirm cleanup
            </div>
            <p className="mt-1 text-xs text-secondary">
              ShipCode verified these selected branches are merged into{' '}
              <span className="font-mono text-primary">
                {analysis?.baseRef ?? 'the default branch'}
              </span>{' '}
              and will re-check before deleting anything.
            </p>
            {hasRemoteSelection ? (
              <p className="mt-1 text-xs text-secondary">
                Remote branch deletion removes refs from origin; branch protection rules may reject
                the push.
              </p>
            ) : null}
            <div className="mt-3 max-h-40 space-y-3 overflow-y-auto rounded-md border border-border bg-primary/70 p-2 text-[11px]">
              {confirmationGroups.worktrees.length > 0 ? (
                <div>
                  <div className="mb-1 font-semibold text-primary">Worktrees</div>
                  <ul className="space-y-1 font-mono text-secondary">
                    {confirmationGroups.worktrees.map((worktree) => (
                      <li key={`${worktree.branch}:${worktree.path}`} className="break-all">
                        {worktree.branch} · {worktree.path}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {confirmationGroups.localBranches.length > 0 ? (
                <div>
                  <div className="mb-1 font-semibold text-primary">Local branches</div>
                  <ul className="space-y-1 font-mono text-secondary">
                    {confirmationGroups.localBranches.map((branch) => (
                      <li key={branch} className="break-all">
                        {branch}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {confirmationGroups.remoteBranches.length > 0 ? (
                <div>
                  <div className="mb-1 font-semibold text-primary">Remote branches</div>
                  <ul className="space-y-1 font-mono text-secondary">
                    {confirmationGroups.remoteBranches.map((branch) => (
                      <li key={branch} className="break-all">
                        {branch}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-primary">
              <Checkbox
                checked={acknowledgedCleanup}
                onCheckedChange={(checked: boolean) => setAcknowledgedCleanup(!!checked)}
              />
              I reviewed this exact list and want to delete only these selected cleanup items.
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
