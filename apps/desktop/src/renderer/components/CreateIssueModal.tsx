import {
  bodyHasRequiredPrdSections,
  clampError,
  formatBytes,
  type GitHubIssueCacheRecord,
  getMissingRequiredPrdSections,
  ISSUE_PIPELINE_STATUS,
  type PrdBlastRadius,
  type PrdEstimatedComplexity,
  type Project,
  readPrdIssueMetadata,
  type StagedPrdAttachment,
} from '@shipcode/shared';
import {
  Button,
  Checkbox,
  cn,
  Input,
  Keycap,
  Label,
  Modal,
  ModalFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { ImageIcon, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';

/**
 * Derive a GitHub issue title from a PRD body. Prefers the first `# ` heading,
 * falls back to the first non-empty line. Truncated to 80 chars so we never
 * ship a runaway title to the API.
 */
function deriveTitleFromBody(body: string): string {
  const lines = body.split('\n').flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
  const heading = lines.find((l) => l.startsWith('# '));
  const raw = heading ? heading.replace(/^#\s+/, '').replace(/^PRD:\s*/i, '') : (lines[0] ?? '');
  return raw.slice(0, 80).trim();
}

function upsertIssueRecord(
  issues: GitHubIssueCacheRecord[],
  issue: GitHubIssueCacheRecord,
  removeId?: string,
): GitHubIssueCacheRecord[] {
  const filtered = issues.filter((candidate) => candidate.id !== removeId);
  const existing = filtered.some((candidate) => candidate.id === issue.id);
  return existing
    ? filtered.map((candidate) => (candidate.id === issue.id ? issue : candidate))
    : [issue, ...filtered];
}

function createPendingIssueRecord({
  projectId,
  title,
  body,
  labels,
}: {
  projectId: string;
  title: string;
  body: string;
  labels: string[];
}): GitHubIssueCacheRecord {
  const now = new Date().toISOString();
  return {
    id: `pending:create:${crypto.randomUUID()}`,
    projectId,
    issueNumber: -Date.now(),
    title,
    body,
    labels,
    assignee: null,
    state: 'open',
    pipelineStatus: ISSUE_PIPELINE_STATUS.queued,
    threadId: null,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: null,
    lastStatusLabel: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    requireApprovalOverride: null,
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: now,
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    syncState: 'creating',
  };
}

type CreateIssueDraftState = {
  body: string;
  estimatedComplexity: PrdEstimatedComplexity;
  blastRadius: PrdBlastRadius;
  error: string | null;
  isQuickMode: boolean;
  quickText: string;
  selectedProjectId: string | null;
};

type EditingPrdDraft = {
  issueNumber: number;
  body: string;
  labels: string[];
};

type CreateIssueDraftAction =
  | { type: 'replace'; state: CreateIssueDraftState }
  | { type: 'body'; body: string }
  | {
      type: 'metadata';
      body: string;
      estimatedComplexity: PrdEstimatedComplexity;
      blastRadius: PrdBlastRadius;
    }
  | { type: 'error'; error: string | null }
  | { type: 'quick-mode'; enabled: boolean }
  | { type: 'quick-text'; text: string }
  | { type: 'project'; projectId: string | null }
  | { type: 'reset-submit-another' };

const EMPTY_CREATE_ISSUE_DRAFT: CreateIssueDraftState = {
  body: '',
  estimatedComplexity: 'medium',
  blastRadius: 'contained',
  error: null,
  isQuickMode: false,
  quickText: '',
  selectedProjectId: null,
};

function createIssueDraftReducer(
  state: CreateIssueDraftState,
  action: CreateIssueDraftAction,
): CreateIssueDraftState {
  switch (action.type) {
    case 'replace':
      return action.state;
    case 'body':
      return { ...state, body: action.body };
    case 'metadata':
      return {
        ...state,
        body: action.body,
        estimatedComplexity: action.estimatedComplexity,
        blastRadius: action.blastRadius,
      };
    case 'error':
      return { ...state, error: action.error };
    case 'quick-mode':
      return { ...state, isQuickMode: action.enabled };
    case 'quick-text':
      return { ...state, quickText: action.text };
    case 'project':
      return { ...state, selectedProjectId: action.projectId };
    case 'reset-submit-another':
      return {
        ...state,
        body: '',
        estimatedComplexity: 'medium',
        blastRadius: 'contained',
        error: null,
        quickText: '',
      };
  }
}

function buildCreateIssueDraftState({
  activeProjectId,
  editingPrd,
  mode,
}: {
  activeProjectId: string | null;
  editingPrd: EditingPrdDraft | null;
  mode: 'create' | 'edit';
}): CreateIssueDraftState {
  if (mode === 'edit' && editingPrd) {
    const metadata = readPrdIssueMetadata(editingPrd.body ?? '', editingPrd.labels);
    return {
      ...EMPTY_CREATE_ISSUE_DRAFT,
      selectedProjectId: activeProjectId,
      body: metadata.cleanBody,
      estimatedComplexity: metadata.estimatedComplexity,
      blastRadius: metadata.blastRadius,
    };
  }
  return { ...EMPTY_CREATE_ISSUE_DRAFT, selectedProjectId: activeProjectId };
}

function useCreateIssueModalView() {
  const queryClient = useQueryClient();
  const createIssueModalOpen = useAppStore((state) => state.createIssueModalOpen);
  const closeCreateIssueModal = useAppStore((state) => state.closeCreateIssueModal);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const editingPrd = useAppStore((state) => state.editingPrd);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const selectProject = useAppStore((state) => state.selectProject);
  const addPendingCreatedIssue = useAppStore((state) => state.addPendingCreatedIssue);
  const removePendingCreatedIssue = useAppStore((state) => state.removePendingCreatedIssue);
  const [draft, dispatchDraft] = useReducer(createIssueDraftReducer, EMPTY_CREATE_ISSUE_DRAFT);
  const {
    body,
    estimatedComplexity,
    blastRadius,
    error,
    isQuickMode,
    quickText,
    selectedProjectId,
  } = draft;
  const [enhancing, setEnhancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitAnother, setSubmitAnother] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke('project:list-visible'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
    enabled: createIssueModalOpen,
  });

  // The project ID used for all operations in this modal
  const effectiveProjectId = selectedProjectId ?? activeProjectId;

  // Attachment state
  const [attachments, setAttachments] = useState<StagedPrdAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const senderIdRef = useRef<string>(crypto.randomUUID());

  const mode: 'create' | 'edit' = editingPrd ? 'edit' : 'create';

  // ---------------------------------------------------------------------------
  // Attachment session lifecycle
  // ---------------------------------------------------------------------------

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!effectiveProjectId) throw new Error('No active project');
    const result = await window.shipcode.invoke<{ sessionId: string }>(
      'prd-attachments:create-session',
      {
        senderId: senderIdRef.current,
        projectId: effectiveProjectId,
      },
    );
    sessionIdRef.current = result.sessionId;
    return result.sessionId;
  }, [effectiveProjectId]);

  const clearAttachmentSession = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    sessionIdRef.current = null;
    setAttachments([]);
    setAttachmentErrors([]);
    try {
      await window.shipcode.invoke('prd-attachments:clear', { sessionId: id });
    } catch (err) {
      log.warn('[CreateIssueModal] failed to clear attachment session', err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // File ingestion
  // ---------------------------------------------------------------------------

  const ingestFiles = useCallback(
    async (files: File[] | string[]) => {
      if (mode !== 'create') return;
      setAttachmentErrors([]);
      try {
        const sessionId = await ensureSession();
        const filePaths = files.map((f) =>
          typeof f === 'string' ? f : (f as File & { path: string }).path,
        );
        const result = await window.shipcode.invoke<{
          staged: StagedPrdAttachment[];
          errors: string[];
        }>('prd-attachments:stage', {
          sessionId,
          filePaths,
        });
        setAttachments((prev) => [...prev, ...result.staged]);
        if (result.errors.length > 0) {
          setAttachmentErrors(result.errors);
        }
      } catch (err) {
        log.error('[CreateIssueModal] stage failed', err);
        setAttachmentErrors([clampError(err)]);
      }
    },
    [ensureSession, mode],
  );

  const handleRemoveAttachment = useCallback(async (attachment: StagedPrdAttachment) => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      await window.shipcode.invoke('prd-attachments:remove', {
        sessionId: id,
        filePath: attachment.originalPath,
      });
      setAttachments((prev) => prev.filter((a) => a.originalPath !== attachment.originalPath));
    } catch (err) {
      log.error('[CreateIssueModal] remove attachment failed', err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Drag-and-drop (entire modal is the drop zone)
  // ---------------------------------------------------------------------------

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        void ingestFiles(files);
      }
    },
    [ingestFiles],
  );

  // ---------------------------------------------------------------------------
  // Modal open/close
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!createIssueModalOpen) return;
    dispatchDraft({
      type: 'replace',
      state: buildCreateIssueDraftState({ activeProjectId, editingPrd, mode }),
    });
    const focusTimeout = setTimeout(() => bodyRef.current?.focus(), 50);
    return () => clearTimeout(focusTimeout);
  }, [createIssueModalOpen, mode, editingPrd, activeProjectId]);

  useEffect(() => {
    if (createIssueModalOpen && isQuickMode) {
      const focusTimeout = setTimeout(() => quickInputRef.current?.focus(), 50);
      return () => clearTimeout(focusTimeout);
    }
  }, [createIssueModalOpen, isQuickMode]);

  const handleClose = useCallback(() => {
    void clearAttachmentSession();
    closeCreateIssueModal();
  }, [clearAttachmentSession, closeCreateIssueModal]);

  const resetDraftForSubmitAnother = useCallback(() => {
    dispatchDraft({ type: 'reset-submit-another' });
    setEnhancing(false);
    setTimeout(() => bodyRef.current?.focus(), 50);
  }, []);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const editBodyValid = bodyHasRequiredPrdSections(body);
  const missingSections = useMemo(() => getMissingRequiredPrdSections(body), [body]);
  const clampedError = useMemo(() => (error ? clampError(error) : null), [error]);
  const derivedTitle = useMemo(() => deriveTitleFromBody(body), [body]);
  const metadataLabels = useMemo(() => [], []);
  const prdMetadata = useMemo(
    () => ({ estimatedComplexity, blastRadius }),
    [blastRadius, estimatedComplexity],
  );

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleEnhance = async () => {
    if (!effectiveProjectId) return;
    setEnhancing(true);
    dispatchDraft({ type: 'error', error: null });
    try {
      const result = await window.shipcode.invoke<{ body: string }>('ai:enhance-prd', {
        projectId: effectiveProjectId,
        draftBody: body,
        attachmentSessionId: sessionIdRef.current,
      });
      const metadata = readPrdIssueMetadata(result.body);
      dispatchDraft({
        type: 'metadata',
        body: metadata.cleanBody,
        estimatedComplexity: metadata.estimatedComplexity,
        blastRadius: metadata.blastRadius,
      });
    } catch (err) {
      log.error('[CreateIssueModal] enhance failed', err);
      dispatchDraft({ type: 'error', error: clampError(err) });
    } finally {
      setEnhancing(false);
    }
  };

  const createGithubIssueInBackground = useCallback(
    ({
      pendingIssue,
      projectId,
      title,
      issueBody,
      labels,
      prdMetadata,
      selectOnComplete,
      showInlineErrors,
    }: {
      pendingIssue: GitHubIssueCacheRecord;
      projectId: string;
      title: string;
      issueBody: string;
      labels: string[];
      prdMetadata: { estimatedComplexity: PrdEstimatedComplexity; blastRadius: PrdBlastRadius };
      selectOnComplete: boolean;
      showInlineErrors: boolean;
    }) => {
      void window.shipcode
        .invoke('github:create-issue', {
          projectId,
          title,
          body: issueBody,
          labels,
          prdMetadata,
        })
        .then((created) => {
          const realIssue = created.issue;
          const planningIssue: GitHubIssueCacheRecord = {
            ...realIssue,
            pipelineStatus: ISSUE_PIPELINE_STATUS.planning,
          };

          queryClient.setQueryData<GitHubIssueCacheRecord[]>(
            ['github-issues', projectId],
            (previous) => upsertIssueRecord(previous ?? [], planningIssue, pendingIssue.id),
          );
          removePendingCreatedIssue(pendingIssue.id);

          const store = useAppStore.getState();
          if (store.activeProjectId === projectId) {
            useAppStore.setState({
              githubIssues: upsertIssueRecord(store.githubIssues, planningIssue, pendingIssue.id),
              activeIssue:
                selectOnComplete || store.activeIssue?.id === pendingIssue.id
                  ? planningIssue
                  : store.activeIssue,
            });
          }

          if (selectOnComplete) {
            selectIssue(planningIssue);
          }

          if (created.projectAttachWarning) {
            log.warn('[CreateIssueModal] project attach warning', created.projectAttachWarning);
          }

          window.shipcode
            .invoke('github:start-issue', {
              projectId,
              issueNumber: realIssue.issueNumber,
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: ['github-issues', projectId] });
            })
            .catch((startErr) => {
              void queryClient.invalidateQueries({ queryKey: ['github-issues', projectId] });
              log.error('[CreateIssueModal] start-issue failed', startErr);
            });
        })
        .catch((err) => {
          log.error('[CreateIssueModal] submit failed', err);
          removePendingCreatedIssue(pendingIssue.id);
          void queryClient.invalidateQueries({ queryKey: ['github-issues', projectId] });
          const message = clampError(err);
          if (showInlineErrors) {
            dispatchDraft({ type: 'error', error: `Failed to create "${title}": ${message}` });
          } else {
            toast.error(`Failed to create issue "${title}"`, message);
          }
        });
    },
    [queryClient, removePendingCreatedIssue, selectIssue],
  );

  const handleSubmit = async () => {
    if (mode === 'create' && isQuickMode) {
      const trimmed = quickText.trim();
      if (!trimmed || !effectiveProjectId) return;
      setSubmitting(true);
      dispatchDraft({ type: 'error', error: null });
      try {
        const { issue } = await window.shipcode.invoke<{ issue: GitHubIssueCacheRecord }>(
          'pipeline:create-quick-task',
          { projectId: effectiveProjectId, text: trimmed },
        );
        await queryClient.invalidateQueries({ queryKey: ['github-issues'] });
        if (effectiveProjectId !== activeProjectId) {
          selectProject(effectiveProjectId);
        }
        selectIssue(issue);
        closeCreateIssueModal();
      } catch (err) {
        log.error('[CreateIssueModal] quick-task submit failed', err);
        dispatchDraft({ type: 'error', error: clampError(err) });
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (mode === 'edit') {
      if (!editBodyValid) return;
    } else {
      if (!derivedTitle || body.trim().length === 0) return;
    }
    if (mode === 'create' && !derivedTitle) return;
    if (!effectiveProjectId) return;
    setSubmitting(true);
    dispatchDraft({ type: 'error', error: null });
    try {
      if (mode === 'edit' && editingPrd) {
        await window.shipcode.invoke('github:edit-issue-body', {
          projectId: effectiveProjectId,
          issueNumber: editingPrd.issueNumber,
          title: derivedTitle,
          body,
          labels: metadataLabels,
          prdMetadata,
        });
        await queryClient.invalidateQueries({ queryKey: ['github-issues'] });
      } else {
        const pendingIssue = createPendingIssueRecord({
          projectId: effectiveProjectId,
          title: derivedTitle,
          body,
          labels: metadataLabels,
        });
        addPendingCreatedIssue(pendingIssue);
        if (effectiveProjectId !== activeProjectId) {
          selectProject(effectiveProjectId);
        }
        createGithubIssueInBackground({
          pendingIssue,
          projectId: effectiveProjectId,
          title: derivedTitle,
          issueBody: body,
          labels: metadataLabels,
          prdMetadata,
          selectOnComplete: !submitAnother,
          showInlineErrors: submitAnother,
        });

        // Clear attachment session immediately. The GitHub issue creation has
        // already captured the body sent to GitHub, and the user can continue
        // drafting while the CLI finishes in the background.
        void clearAttachmentSession();
        if (submitAnother) {
          resetDraftForSubmitAnother();
          setSubmitting(false);
          return;
        }
        closeCreateIssueModal();
        setSubmitting(false);
        return;
      }
      // Clear attachment session on successful submit
      void clearAttachmentSession();
      closeCreateIssueModal();
    } catch (err) {
      log.error('[CreateIssueModal] submit failed', err);
      dispatchDraft({ type: 'error', error: clampError(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
    if (e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const bodyIsEmpty = body.trim().length === 0;

  // Submit disabled logic differs by mode.
  const noProject = !effectiveProjectId;
  const titleMissing = mode === 'create' && !derivedTitle;
  const quickTextEmpty = quickText.trim().length === 0;
  const submitDisabled =
    mode === 'edit'
      ? !editBodyValid || submitting || enhancing
      : isQuickMode
        ? noProject || quickTextEmpty || submitting
        : noProject || titleMissing || bodyIsEmpty || submitting || enhancing;

  const submitLabel = mode === 'edit' ? 'Save' : isQuickMode ? 'Run Quick Task' : 'Create';

  const hasAttachments = attachments.length > 0;

  return (
    <Modal
      open={createIssueModalOpen}
      onClose={handleClose}
      title={mode === 'edit' ? 'Edit PRD' : 'New Issue'}
      className="max-w-[720px] max-h-[88vh] flex flex-col overflow-hidden p-0"
      headerClassName="shrink-0 border-b border-border px-6 py-4"
      onKeyDown={handleKeyDown}
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4"
        data-create-issue-scroll-region
      >
        <section
          aria-label="Issue content"
          className={cn(
            'flex flex-col gap-4 transition-colors',
            dragActive && 'rounded-xl ring-2 ring-accent/50 bg-accent/5',
          )}
          onDragOver={mode === 'create' ? handleDragOver : undefined}
          onDragLeave={mode === 'create' ? handleDragLeave : undefined}
          onDrop={mode === 'create' ? handleDrop : undefined}
        >
          {/* Notifications — above textarea */}
          {mode === 'edit' && !editBodyValid && body.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
              <span className="min-w-0 flex-1">
                Missing required sections: {missingSections.join(', ')}
              </span>
              <Button
                variant="ghost"
                size="xs"
                className="shrink-0 text-warning hover:text-warning hover:bg-warning/20"
                onClick={handleEnhance}
                disabled={enhancing || submitting || bodyIsEmpty || hasAttachments}
              >
                <LoadingButtonContent loading={enhancing} className="gap-1" spinnerSize={10}>
                  Format
                </LoadingButtonContent>
              </Button>
            </div>
          )}

          {clampedError && (
            <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1">{clampedError}</span>
                <span className="ml-2 text-muted-foreground">(full trace in devtools console)</span>
              </span>
              {!isQuickMode && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-danger hover:text-danger hover:bg-danger/20"
                  onClick={handleEnhance}
                  disabled={enhancing || submitting || bodyIsEmpty || hasAttachments}
                >
                  <LoadingButtonContent loading={enhancing} className="gap-1" spinnerSize={10}>
                    Retry
                  </LoadingButtonContent>
                </Button>
              )}
            </div>
          )}

          {mode === 'create' && isQuickMode && (
            <div className="flex flex-col gap-2">
              <Input
                ref={quickInputRef}
                value={quickText}
                onChange={(e) => dispatchDraft({ type: 'quick-text', text: e.target.value })}
                placeholder="Describe the fix in one line…"
                disabled={submitting}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !submitDisabled) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
              />
              {projects.length > 0 && (
                <div className="flex w-48 flex-col gap-1">
                  <Label htmlFor="quick-project" className="text-xs text-secondary">
                    Project
                  </Label>
                  <Select
                    value={effectiveProjectId ?? ''}
                    onValueChange={(value) => dispatchDraft({ type: 'project', projectId: value })}
                  >
                    <SelectTrigger id="quick-project" className="bg-transparent">
                      <SelectValue placeholder="Select a project..." />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {attachmentErrors.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
              {attachmentErrors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}

          {!isQuickMode && (
            <Textarea
              ref={bodyRef}
              id="issue-body"
              value={body}
              onChange={(e) => dispatchDraft({ type: 'body', body: e.target.value })}
              placeholder={
                mode === 'create' ? 'Describe what you want to build…' : 'PRD markdown...'
              }
              rows={mode === 'create' ? 5 : 14}
              className={
                mode === 'edit' && editBodyValid
                  ? 'font-mono text-xs'
                  : mode === 'edit'
                    ? 'font-mono text-xs'
                    : 'text-[13px]'
              }
              disabled={enhancing}
            />
          )}

          {/* Project + Format row — below textarea in create mode */}
          {mode === 'create' && !isQuickMode && projects.length > 0 && (
            <div className="flex items-end gap-2">
              <div className="flex w-48 flex-col gap-1">
                <Label htmlFor="issue-project" className="text-xs text-secondary">
                  Project
                </Label>
                <Select
                  value={effectiveProjectId ?? ''}
                  onValueChange={(value) => dispatchDraft({ type: 'project', projectId: value })}
                >
                  <SelectTrigger id="issue-project" className="bg-transparent">
                    <SelectValue placeholder="Select a project..." />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="secondary"
                onClick={handleEnhance}
                disabled={enhancing || submitting || bodyIsEmpty || hasAttachments}
                title={
                  hasAttachments
                    ? 'Remove attachments before using Format (not yet supported with images)'
                    : "Let AI structure your idea into a full PRD using this repo's writing-prds skill"
                }
              >
                <LoadingButtonContent loading={enhancing}>Format</LoadingButtonContent>
              </Button>
            </div>
          )}

          {/* Format button for edit mode — no project selector needed */}
          {mode === 'edit' && (
            <Button
              variant="secondary"
              onClick={handleEnhance}
              disabled={enhancing || submitting || bodyIsEmpty || hasAttachments}
              className="self-start"
              title={
                hasAttachments
                  ? 'Remove attachments before using Format (not yet supported with images)'
                  : "Let AI structure your idea into a full PRD using this repo's writing-prds skill"
              }
            >
              <LoadingButtonContent loading={enhancing}>Format</LoadingButtonContent>
            </Button>
          )}

          {/* Staged attachments list */}
          {hasAttachments && (
            <div className="flex flex-col gap-1">
              {attachments.map((a) => (
                <div
                  key={a.originalPath}
                  className="flex items-center gap-2 rounded-md border border-border bg-tertiary/30 px-2.5 py-1.5 text-xs"
                >
                  <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-secondary" title={a.fileName}>
                    {a.fileName}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${a.fileName}`}
                    className="h-6 w-6 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemoveAttachment(a);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <ModalFooter className="shrink-0 items-center border-t border-border px-6 py-4 mt-0">
        {mode === 'create' && (
          <div className="mr-auto flex items-center gap-3">
            <Label
              htmlFor="quick-mode-toggle"
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-tertiary/40 px-3 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary"
            >
              <Checkbox
                id="quick-mode-toggle"
                checked={isQuickMode}
                onCheckedChange={(checked) =>
                  dispatchDraft({ type: 'quick-mode', enabled: checked === true })
                }
                disabled={submitting || enhancing}
                aria-label="Quick mode (skip PRD, no GitHub issue)"
              />
              Quick
            </Label>
            {!isQuickMode && (
              <Label
                htmlFor="submit-another"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-tertiary/40 px-3 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary"
              >
                <Checkbox
                  id="submit-another"
                  checked={submitAnother}
                  onCheckedChange={(checked) => setSubmitAnother(checked === true)}
                  disabled={submitting || enhancing}
                />
                Submit another
              </Label>
            )}
          </div>
        )}
        <Button variant="secondary" onClick={handleClose} disabled={submitting || enhancing}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={submitDisabled}
          aria-label={mode === 'edit' ? 'Save PRD' : undefined}
        >
          <LoadingButtonContent loading={submitting}>
            <span>{submitLabel}</span>
            <Keycap>{isQuickMode ? '↩' : '⌘↩'}</Keycap>
          </LoadingButtonContent>
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function CreateIssueModal() {
  return useCreateIssueModalView();
}
