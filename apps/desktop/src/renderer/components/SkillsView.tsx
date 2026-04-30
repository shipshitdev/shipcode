import type { PhaseSkillKey } from '@shipcode/shared';
import {
  Badge,
  Button,
  cn,
  LoadingButtonContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/app-store';
import { PageHeader } from './PageHeader';

// The row shape below mirrors what apps/desktop/src/main/ipc.ts builds in
// `buildSkillRow`. The IPC channel itself is typed as `unknown` in shared to
// avoid pulling `@shipcode/agents` types (BundledDefault, ResolvedSkill) into
// the shared package.

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

interface WritingPrdsSkillInfoView {
  projectId: string;
  projectPath: string;
  absolutePath: string;
  exists: boolean;
  usingFallback: boolean;
  openTargetPath: string;
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
  'pr-generation': {
    label: 'PR Writer',
    description: 'Generates the pull request body content',
  },
};

const SCOPE_GLOBAL = '__GLOBAL__' as const;

export function SkillsView() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
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
    void activeProjectId;
    setScope(SCOPE_GLOBAL);
  }, [activeProjectId]);

  const { data: list, isLoading } = useQuery<SkillListEntry[]>({
    queryKey: ['skills:list', projectId],
    queryFn: () => window.shipcode.invoke<SkillListEntry[]>('skills:list-for-view', { projectId }),
  });

  const { data: writingPrdsInfo } = useQuery<WritingPrdsSkillInfoView>({
    queryKey: ['skills:writing-prds', activeProjectId],
    queryFn: () =>
      window.shipcode.invoke<WritingPrdsSkillInfoView>('skills:get-writing-prds-info', {
        projectId: activeProjectId as string,
      }),
    enabled: Boolean(activeProjectId),
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
      window.shipcode.invoke<{ ok: boolean; error?: { message: string }; row?: SkillRowView }>(
        'skills:write',
        {
          projectId,
          phase: activePhase,
          content,
        },
      ),
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
    mutationFn: (): Promise<void> =>
      window.shipcode.invoke<void>('skills:reset', {
        projectId,
        phase: activePhase,
      }),
    onSuccess: () => {
      setValidationError(null);
      setDraftDirty(false);
      queryClient.invalidateQueries({ queryKey: ['skills:list'] });
    },
  });

  const openWritingPrdsMutation = useMutation({
    mutationFn: (): Promise<void> =>
      window.shipcode.invoke<void>('skills:open-writing-prds', {
        projectId: activeProjectId as string,
      }),
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
    () =>
      list?.flatMap((e) =>
        [e.projectRow, e.globalRow].filter((r) => r?.status === 'quarantined'),
      ) ?? [],
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
    <div className="flex flex-1 flex-col overflow-hidden bg-primary">
      <PageHeader title="Skills" subtitle="Customize prompts for each pipeline phase." />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[260px] shrink-0 overflow-y-auto border-r border-border bg-primary">
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
                const row =
                  projectId !== null ? (entry.projectRow ?? entry.globalRow) : entry.globalRow;
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

            <div className="mt-6 border-t border-border pt-4">
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Other Skills
              </h4>
              <div className="rounded border border-border bg-secondary/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-primary">writing-prds</span>
                      <Badge variant="info" className="text-[9px]">
                        Repo file
                      </Badge>
                      {writingPrdsInfo ? (
                        <Badge
                          variant={writingPrdsInfo.exists ? 'success' : 'default'}
                          className="text-[9px]"
                        >
                          {writingPrdsInfo.exists ? 'Present' : 'Fallback'}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-secondary">
                      PRD enhancement style guide. Owned by the active repo, not ShipCode&apos;s
                      DB-backed pipeline skill system.
                    </p>
                  </div>
                </div>

                {activeProjectId && writingPrdsInfo ? (
                  <>
                    <div className="mt-3 rounded border border-border bg-primary/60 px-2 py-1.5 font-mono text-[10px] leading-snug text-muted break-all">
                      {writingPrdsInfo.absolutePath}
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-muted">
                      {writingPrdsInfo.exists
                        ? 'Edit this file in your normal editor. ShipCode reads it directly when you enhance a PRD.'
                        : 'This repo is using ShipCode’s built-in fallback because the file is missing. Open the repo to add or inspect the skill location.'}
                    </p>
                    <Button
                      variant="secondary"
                      className="mt-3 w-full"
                      onClick={() => openWritingPrdsMutation.mutate()}
                      disabled={openWritingPrdsMutation.isPending}
                    >
                      <LoadingButtonContent loading={openWritingPrdsMutation.isPending}>
                        Open in system editor
                      </LoadingButtonContent>
                    </Button>
                  </>
                ) : (
                  <p className="mt-3 text-[11px] leading-snug text-muted">
                    Pick a project from the sidebar to inspect that repo&apos;s
                    <span className="mx-1 font-mono">.agents/skills/writing-prds/SKILL.md</span>
                    file.
                  </p>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Right: editor */}
        <section className="flex-1 overflow-y-auto bg-primary">
          <div className="p-8 max-w-5xl">
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
                  {quarantinedRows.map((row) =>
                    row ? (
                      <li
                        key={`${row.phase}-${row.projectId ?? 'global'}-${row.statusReason ?? 'quarantined'}`}
                        className="text-[11px]"
                      >
                        <span className="font-medium text-primary">
                          {PHASE_LABELS[row.phase].label}
                        </span>{' '}
                        <span className="text-muted">({row.projectId ? 'project' : 'global'})</span>
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
                        Source:{' '}
                        <SourceBadge
                          source={editingRow.source}
                          quarantined={editingRow.status === 'quarantined'}
                          inline
                        />
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
                      aria-label="Reset skill to bundled default"
                    >
                      Reset
                    </Button>
                    <Button onClick={handleSave} disabled={!draftDirty || writeMutation.isPending}>
                      <LoadingButtonContent loading={writeMutation.isPending}>
                        Save
                      </LoadingButtonContent>
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
                      <Badge
                        key={slot}
                        variant="info"
                        className="font-mono text-[10px] normal-case"
                      >
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
  const labels: Record<typeof source, { label: string; variant: 'default' | 'success' | 'info' }> =
    {
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
