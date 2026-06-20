import { clampError, type PhaseSkillKey, type RepoSkillSeedResult } from '@shipcode/shared';
import { PageHeader } from '@shipcode/ui';
import {
  Badge,
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useAppStore } from '../stores/app-store';

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

interface SkillRewriteResult {
  content: string;
}

const SOURCE_BADGE_META: Record<
  SkillRowView['source'],
  { label: string; variant: 'default' | 'success' | 'info' }
> = {
  project: { label: 'Project', variant: 'success' },
  global: { label: 'Global', variant: 'info' },
  default: { label: 'Default', variant: 'default' },
};

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
const SKILLS_LOADING_ROW_KEYS = [
  'skills-loading-1',
  'skills-loading-2',
  'skills-loading-3',
  'skills-loading-4',
  'skills-loading-5',
  'skills-loading-6',
  'skills-loading-7',
];

const SCOPE_GLOBAL = '__GLOBAL__' as const;

// Scope picker + dev-loop seed feedback are reset together whenever the active
// project changes. Folding them into one reducer keeps that reset (and the
// mutually-exclusive seed notice/error) a single state update, so the effect
// produces one re-render instead of three (react-doctor/no-cascading-set-state).
interface SkillsScopeState {
  scope: string;
  seedNotice: string | null;
  seedError: string | null;
}

type SkillsScopeAction =
  | { type: 'project-changed' }
  | { type: 'set-scope'; scope: string }
  | { type: 'seed-success'; notice: string }
  | { type: 'seed-error'; error: string };

const INITIAL_SCOPE_STATE: SkillsScopeState = {
  scope: SCOPE_GLOBAL,
  seedNotice: null,
  seedError: null,
};

function skillsScopeReducer(state: SkillsScopeState, action: SkillsScopeAction): SkillsScopeState {
  switch (action.type) {
    // Switching projects clears any stale per-project view in one update.
    case 'project-changed':
      return INITIAL_SCOPE_STATE;
    case 'set-scope':
      return { ...state, scope: action.scope };
    // Seed notice and error are mutually exclusive — showing one clears the other.
    case 'seed-success':
      return { ...state, seedNotice: action.notice, seedError: null };
    case 'seed-error':
      return { ...state, seedError: action.error, seedNotice: null };
    default:
      return state;
  }
}

function useSkillsView() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const [scopeState, dispatchScope] = useReducer(skillsScopeReducer, INITIAL_SCOPE_STATE);
  const { scope, seedNotice, seedError } = scopeState;
  const [activePhase, setActivePhase] = useState<PhaseSkillKey>('plan-generation');
  const [draft, setDraft] = useState<string>('');
  const [draftDirty, setDraftDirty] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [rewriteNotice, setRewriteNotice] = useState<string | null>(null);

  const projectId = scope === SCOPE_GLOBAL ? null : scope;

  // Reset to global scope whenever the user switches projects so the page
  // doesn't keep showing a stale per-project override view from the prior
  // project.
  useEffect(() => {
    void activeProjectId;
    dispatchScope({ type: 'project-changed' });
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

  const editorContent = draftDirty ? draft : (editingRow?.content ?? '');
  const resetEditorChrome = () => {
    setDraft('');
    setDraftDirty(false);
    setValidationError(null);
    setRewriteInstruction('');
    setRewriteError(null);
    setRewriteNotice(null);
  };
  const handleScopeChange = (value: string) => {
    dispatchScope({ type: 'set-scope', scope: value });
    resetEditorChrome();
  };
  const handlePhaseChange = (phase: PhaseSkillKey) => {
    setActivePhase(phase);
    resetEditorChrome();
  };

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
    onSuccess: (result, variables) => {
      if (!result.ok && result.error) {
        setValidationError(result.error.message);
        return;
      }
      setValidationError(null);
      setDraft(result.row?.content ?? variables.content);
      setDraftDirty(false);
      queryClient.invalidateQueries({ queryKey: ['skills:list'] });
    },
    onError: (err: unknown) => {
      setValidationError(err instanceof Error ? err.message : String(err));
    },
  });

  const rewriteMutation = useMutation({
    mutationFn: ({
      instruction,
      content,
    }: {
      instruction: string;
      content: string;
    }): Promise<SkillRewriteResult> =>
      window.shipcode.invoke<SkillRewriteResult>('skills:rewrite', {
        projectId,
        contextProjectId: activeProjectId,
        phase: activePhase,
        content,
        instruction,
      }),
    onSuccess: (result) => {
      const err = clientValidate(result.content);
      if (err) {
        setRewriteError(err);
        setValidationError(err);
        return;
      }
      setDraft(result.content);
      setDraftDirty(true);
      setValidationError(null);
      setRewriteError(null);
      setRewriteNotice('Draft rewritten. Review and save when ready.');
      queryClient.invalidateQueries({ queryKey: ['skills:list'] });
    },
    onError: (err: unknown) => {
      setRewriteError(clampError(err));
      setRewriteNotice(null);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills:list'] });
    },
  });

  const seedRepoSkillsMutation = useMutation({
    mutationFn: ({ projectId: pid }: { projectId: string }): Promise<RepoSkillSeedResult> =>
      window.shipcode.invoke<RepoSkillSeedResult>('skills:seed-repo-bundle', {
        projectId: pid,
        bundle: 'dev-loop',
      }),
    onSuccess: (result, variables) => {
      const written = result.files.filter((file) => file.status === 'written').length;
      const skipped = result.files.filter((file) => file.status === 'skipped').length;
      dispatchScope({
        type: 'seed-success',
        notice: `Dev-loop skills seeded: ${written} written, ${skipped} skipped.`,
      });
      queryClient.invalidateQueries({ queryKey: ['skills:writing-prds', variables.projectId] });
    },
    onError: (err: unknown) => {
      dispatchScope({ type: 'seed-error', error: clampError(err) });
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
    const err = clientValidate(editorContent);
    if (err) {
      setValidationError(err);
      return;
    }
    writeMutation.mutate({ content: editorContent });
  };

  const handleRewrite = () => {
    const instruction = rewriteInstruction.trim();
    if (!instruction) {
      setRewriteError('Enter rewrite instructions first.');
      return;
    }
    setRewriteError(null);
    setRewriteNotice(null);
    rewriteMutation.mutate({ instruction, content: editorContent });
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
      <div className="flex flex-1 flex-col overflow-hidden bg-primary">
        <PageHeader title="Skills" subtitle="Customize prompts for each pipeline phase." />
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-[260px] shrink-0 border-r border-border bg-primary p-4">
            <Skeleton className="mb-4 h-3 w-24" />
            <div className="space-y-2">
              {SKILLS_LOADING_ROW_KEYS.map((key) => (
                <Skeleton key={key} className="h-8 w-full rounded-md" />
              ))}
            </div>
          </aside>
          <div className="flex flex-1 flex-col p-6">
            <Skeleton className="mb-3 h-4 w-32" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-primary">
      <PageHeader title="Skills" subtitle="Customize prompts for each pipeline phase." />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[260px] shrink-0 overflow-y-auto border-r border-border bg-primary">
          <div className="p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Pipeline Skills
            </h3>
            <p className="text-[11px] text-secondary mb-4 leading-relaxed">
              Edit the prompt that drives each phase of the pipeline. Changes save to your local DB
              and apply on the next run.
            </p>

            {/* Scope picker */}
            <div className="mb-4">
              <label
                htmlFor="skills-scope-select"
                className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1"
              >
                Scope
              </label>
              <Select value={scope} onValueChange={handleScopeChange}>
                <SelectTrigger id="skills-scope-select" className="w-full text-[12px]">
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
                      onClick={() => handlePhaseChange(entry.phase)}
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
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {meta.description}
                        </p>
                      </div>
                    </Button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 border-t border-border pt-4">
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Repo Skills
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
                      Controls AI PRD enhancement. This is a repo file, not a DB-backed pipeline
                      phase override.
                    </p>
                  </div>
                </div>

                {activeProjectId && writingPrdsInfo ? (
                  <>
                    <div className="mt-3 rounded border border-border bg-primary/60 px-2 py-1.5 font-mono text-[10px] leading-snug text-muted-foreground break-all">
                      {writingPrdsInfo.absolutePath}
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
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
                    <Button
                      variant="secondary"
                      className="mt-2 w-full"
                      onClick={() => {
                        if (!activeProjectId) return;
                        seedRepoSkillsMutation.mutate({ projectId: activeProjectId });
                      }}
                      disabled={seedRepoSkillsMutation.isPending}
                    >
                      <LoadingButtonContent loading={seedRepoSkillsMutation.isPending}>
                        <Download size={13} aria-hidden="true" />
                        Seed dev-loop skills
                      </LoadingButtonContent>
                    </Button>
                    {seedError ? (
                      <div
                        role="alert"
                        className="mt-2 rounded border border-red-500/40 bg-red-500/5 p-2 text-[11px] text-red-300"
                      >
                        {seedError}
                      </div>
                    ) : seedNotice ? (
                      <div
                        aria-live="polite"
                        className="mt-2 rounded border border-green-500/30 bg-green-500/5 p-2 text-[11px] text-green-300"
                      >
                        {seedNotice}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
                    Pick a project from the sidebar to inspect that repo&apos;s
                    <span className="mx-1 font-mono">skills/writing-prds/SKILL.md</span>
                    file and seed dev-loop skills.
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
                        <span className="text-muted-foreground">
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
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
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
                  aria-label="Skill content"
                  value={editorContent}
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

                <div className="mt-4 rounded border border-border bg-secondary/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label
                      htmlFor="skill-rewrite-instructions"
                      className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Rewrite instructions
                    </label>
                    <Button
                      variant="secondary"
                      onClick={handleRewrite}
                      disabled={rewriteMutation.isPending || !rewriteInstruction.trim()}
                    >
                      <LoadingButtonContent loading={rewriteMutation.isPending}>
                        <Sparkles size={13} aria-hidden="true" />
                        Rewrite draft
                      </LoadingButtonContent>
                    </Button>
                  </div>
                  <Textarea
                    id="skill-rewrite-instructions"
                    value={rewriteInstruction}
                    onChange={(e) => {
                      setRewriteInstruction(e.target.value);
                      setRewriteError(null);
                      setRewriteNotice(null);
                    }}
                    rows={3}
                    placeholder="Example: adapt this phase for a board with Backlog, Ready, In progress, Review, and Done; require verifier evidence before Review."
                    className="text-[12px] leading-relaxed"
                  />
                  {rewriteError ? (
                    <div className="mt-2 rounded border border-red-500/40 bg-red-500/5 p-2 text-[11px] text-red-300">
                      {rewriteError}
                    </div>
                  ) : rewriteNotice ? (
                    <div className="mt-2 rounded border border-green-500/30 bg-green-500/5 p-2 text-[11px] text-green-300">
                      {rewriteNotice}
                    </div>
                  ) : null}
                </div>

                <div className="mt-6 rounded border border-border bg-secondary/40 p-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
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
                  <p className="mt-2 text-[11px] text-muted-foreground">
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

export function SkillsView() {
  return useSkillsView();
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
  const meta = SOURCE_BADGE_META[source];
  return (
    <Badge variant={meta.variant} className={cn('text-[9px]', inline && 'ml-1')}>
      {meta.label}
    </Badge>
  );
}
