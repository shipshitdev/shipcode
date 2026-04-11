import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Textarea,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';

// These types mirror what apps/desktop/src/main/ipc.ts builds in `buildSkillRow`.
// Kept loose because the IPC channel is typed as `unknown` in shared (to avoid
// a shared → agents dep cycle).
type PhaseSkillKey =
  | 'plan-generation'
  | 'adversarial-review'
  | 'plan-revision'
  | 'plan-execution'
  | 'plan-verification';

interface SkillRowView {
  phase: PhaseSkillKey;
  projectId: string | null;
  source: 'project' | 'global' | 'default';
  content: string;
  baseVersion: string;
  schemaVersion: number;
  bundledVersion: string;
  bundledSchemaVersion: number;
  requiredSlots: readonly string[];
  status: 'ok' | 'quarantined';
  statusReason: string | null;
  updatedAt: string | null;
}

interface SkillListEntry {
  phase: PhaseSkillKey;
  requiredSlots: readonly string[];
  bundledVersion: string;
  bundledSchemaVersion: number;
  projectRow: SkillRowView | null;
  globalRow: SkillRowView;
  active: SkillRowView;
}

const PHASE_LABELS: Record<PhaseSkillKey, { label: string; description: string }> = {
  'plan-generation': {
    label: 'Planner',
    description: 'Turns a user task into a ShipCodePlan',
  },
  'adversarial-review': {
    label: 'Reviewer',
    description: 'Breaks confidence in the plan before execution',
  },
  'plan-revision': {
    label: 'Reviser',
    description: 'Rewrites the plan to address review findings',
  },
  'plan-execution': {
    label: 'Executor',
    description: 'Applies the approved plan inside a git worktree',
  },
  'plan-verification': {
    label: 'Verifier',
    description: 'Confirms the diff matches the plan',
  },
};

const SCOPE_GLOBAL = '__GLOBAL__' as const;

export function SkillsView() {
  const queryClient = useQueryClient();
  const { activeProjectId } = useAppStore();
  const [scope, setScope] = useState<string>(SCOPE_GLOBAL);
  const [activePhase, setActivePhase] = useState<PhaseSkillKey>('plan-generation');
  const [draft, setDraft] = useState<string>('');
  const [draftDirty, setDraftDirty] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const projectId = scope === SCOPE_GLOBAL ? null : scope;

  // Reset to global scope whenever the user switches projects so the page
  // doesn't keep showing a stale per-project override view from the prior
  // project.
  useEffect(() => {
    setScope(SCOPE_GLOBAL);
  }, [activeProjectId]);

  const { data: list, isLoading } = useQuery<SkillListEntry[]>({
    queryKey: ['skills:list', projectId],
    queryFn: () => window.shipcode.invoke('skills:list-for-view', { projectId }),
  });

  const activeEntry = useMemo(
    () => list?.find((e) => e.phase === activePhase) ?? null,
    [list, activePhase],
  );

  // Pick the row at the current scope (project tier when projectId is set,
  // otherwise global tier). The editor always edits at the selected scope.
  const editingRow = useMemo<SkillRowView | null>(() => {
    if (!activeEntry) return null;
    if (projectId !== null) {
      return activeEntry.projectRow ?? activeEntry.globalRow;
    }
    return activeEntry.globalRow;
  }, [activeEntry, projectId]);

  // Reset draft whenever the editing row changes (different phase or scope).
  useEffect(() => {
    setDraft(editingRow?.content ?? '');
    setDraftDirty(false);
    setValidationError(null);
  }, [editingRow]);

  const writeMutation = useMutation({
    mutationFn: ({
      content,
    }: {
      content: string;
    }): Promise<{ ok: boolean; error?: { message: string }; row?: SkillRowView }> =>
      window.shipcode.invoke('skills:write', {
        projectId,
        phase: activePhase,
        content,
      }),
    onSuccess: (result) => {
      if (!result.ok && result.error) {
        setValidationError(result.error.message);
        return;
      }
      setValidationError(null);
      setDraftDirty(false);
      queryClient.invalidateQueries({ queryKey: ['skills:list'] });
    },
    onError: (err: unknown) => {
      setValidationError(err instanceof Error ? err.message : String(err));
    },
  });

  const resetMutation = useMutation({
    mutationFn: () =>
      window.shipcode.invoke('skills:reset', {
        projectId,
        phase: activePhase,
      }),
    onSuccess: () => {
      setValidationError(null);
      setDraftDirty(false);
      queryClient.invalidateQueries({ queryKey: ['skills:list'] });
    },
  });

  // Pre-validate before save so the renderer gives early feedback. The same
  // check runs again in main process; this is just UX, not authoritative.
  function clientValidate(content: string): string | null {
    if (!activeEntry) return null;
    if (!/^---\n[\s\S]*?\n---\n/.test(content)) {
      return 'Skill must start with a YAML frontmatter block delimited by ---';
    }
    const body = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    const missing = activeEntry.requiredSlots.filter((slot) => !body.includes(`{{${slot}}}`));
    if (missing.length > 0) {
      return `Missing required slot${missing.length > 1 ? 's' : ''}: ${missing.map((s) => `{{${s}}}`).join(', ')}`;
    }
    return null;
  }

  const handleSave = () => {
    const err = clientValidate(draft);
    if (err) {
      setValidationError(err);
      return;
    }
    writeMutation.mutate({ content: draft });
  };

  const quarantinedRows = useMemo(
    () => list?.flatMap((e) => [e.projectRow, e.globalRow].filter((r) => r?.status === 'quarantined')) ?? [],
    [list],
  );

  if (isLoading || !list) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-secondary">
        Loading skills…
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: phase list */}
      <aside className="w-[260px] shrink-0 border-r border-border overflow-y-auto">
        <div className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Pipeline Skills
          </h3>
          <p className="text-[11px] text-secondary mb-4 leading-relaxed">
            Edit the prompt that drives each phase of the pipeline. Changes save to your local DB
            and apply on the next run.
          </p>

          {/* Scope picker */}
          <div className="mb-4">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
              Scope
            </label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="w-full text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SCOPE_GLOBAL}>Global (all projects)</SelectItem>
                {activeProjectId && (
                  <SelectItem value={activeProjectId}>Current project only</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <ul className="flex flex-col gap-1">
            {list.map((entry) => {
              const meta = PHASE_LABELS[entry.phase];
              const isActive = entry.phase === activePhase;
              const row = projectId !== null ? (entry.projectRow ?? entry.globalRow) : entry.globalRow;
              const isQuarantined = row.status === 'quarantined';
              return (
                <li key={entry.phase}>
                  <Button
                    variant="ghost"
                    onClick={() => setActivePhase(entry.phase)}
                    className={cn(
                      'w-full h-auto justify-start text-left rounded px-3 py-2 text-[13px] border border-transparent whitespace-normal',
                      isActive
                        ? 'bg-tertiary text-primary border-border'
                        : 'text-secondary hover:bg-hover hover:text-primary',
                    )}
                  >
                    <div className="flex flex-col w-full gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{meta.label}</span>
                        <SourceBadge source={row.source} quarantined={isQuarantined} />
                      </div>
                      <p className="text-[11px] text-muted leading-snug">{meta.description}</p>
                    </div>
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* Right: editor */}
      <section className="flex-1 overflow-y-auto">
        <div className="p-8">
          {quarantinedRows.length > 0 && (
            <div className="mb-6 rounded border border-red-500/40 bg-red-500/5 p-4">
              <h4 className="text-sm font-semibold text-red-400 mb-1">
                Quarantined skill overrides
              </h4>
              <p className="text-[11px] text-secondary mb-3">
                These overrides failed validation and are NOT being used. The bundled default ran
                in their place. Edit them to fix, or click Reset to discard.
              </p>
              <ul className="flex flex-col gap-1">
                {quarantinedRows.map((row, idx) =>
                  row ? (
                    <li key={`${row.phase}-${row.projectId ?? 'global'}-${idx}`} className="text-[11px]">
                      <span className="font-medium text-primary">
                        {PHASE_LABELS[row.phase].label}
                      </span>{' '}
                      <span className="text-muted">
                        ({row.projectId ? 'project' : 'global'})
                      </span>
                      : <span className="text-red-300">{row.statusReason}</span>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}

          {activeEntry && editingRow && (
            <>
              <header className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-primary">
                    {PHASE_LABELS[activePhase].label} skill
                  </h3>
                  <p className="text-[12px] text-secondary mt-0.5">
                    {PHASE_LABELS[activePhase].description}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                    <span>
                      Source: <SourceBadge source={editingRow.source} quarantined={editingRow.status === 'quarantined'} inline />
                    </span>
                    <span>Bundled v{activeEntry.bundledVersion}</span>
                    {editingRow.source !== 'default' && (
                      <span>
                        Forked from v{editingRow.baseVersion}
                        {editingRow.baseVersion !== activeEntry.bundledVersion && (
                          <span className="text-yellow-400 ml-1">(bundled has updated)</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {draftDirty && (
                    <span className="text-[11px] text-yellow-400">Unsaved changes</span>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => resetMutation.mutate()}
                    disabled={resetMutation.isPending || editingRow.source === 'default'}
                  >
                    Reset to default
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={!draftDirty || writeMutation.isPending}
                  >
                    {writeMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </header>

              <Textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftDirty(true);
                  setValidationError(null);
                }}
                rows={28}
                spellCheck={false}
                className="font-mono text-[12px] leading-relaxed"
              />

              {validationError && (
                <div className="mt-3 rounded border border-red-500/40 bg-red-500/5 p-3 text-[12px] text-red-300">
                  {validationError}
                </div>
              )}

              <div className="mt-6 rounded border border-border bg-secondary/40 p-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">
                  Required slots
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {activeEntry.requiredSlots.map((slot) => (
                    <Badge key={slot} variant="info" className="font-mono text-[10px] normal-case">
                      {`{{${slot}}}`}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  These slots MUST appear in the skill body. Saving without them will be rejected.
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function SourceBadge({
  source,
  quarantined,
  inline,
}: {
  source: 'project' | 'global' | 'default';
  quarantined?: boolean;
  inline?: boolean;
}) {
  if (quarantined) {
    return (
      <Badge variant="danger" className={cn('text-[9px]', inline && 'ml-1')}>
        Quarantined
      </Badge>
    );
  }
  const labels: Record<
    typeof source,
    { label: string; variant: 'default' | 'success' | 'info' }
  > = {
    project: { label: 'Project', variant: 'success' },
    global: { label: 'Global', variant: 'info' },
    default: { label: 'Default', variant: 'default' },
  };
  const meta = labels[source];
  return (
    <Badge variant={meta.variant} className={cn('text-[9px]', inline && 'ml-1')}>
      {meta.label}
    </Badge>
  );
}
