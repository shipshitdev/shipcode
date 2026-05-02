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
  LoadingButtonContent,
  Modal,
  ModalFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { ImageIcon, Mic, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';

/**
 * Derive a GitHub issue title from a PRD body. Prefers the first `# ` heading,
 * falls back to the first non-empty line. Truncated to 80 chars so we never
 * ship a runaway title to the API.
 */
function deriveTitleFromBody(body: string): string {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
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

export function CreateIssueModal() {
  const queryClient = useQueryClient();
  const createIssueModalOpen = useAppStore((state) => state.createIssueModalOpen);
  const closeCreateIssueModal = useAppStore((state) => state.closeCreateIssueModal);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const editingPrd = useAppStore((state) => state.editingPrd);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const selectProject = useAppStore((state) => state.selectProject);
  const addPendingCreatedIssue = useAppStore((state) => state.addPendingCreatedIssue);
  const removePendingCreatedIssue = useAppStore((state) => state.removePendingCreatedIssue);
  const [body, setBody] = useState('');
  const [estimatedComplexity, setEstimatedComplexity] = useState<PrdEstimatedComplexity>('medium');
  const [blastRadius, setBlastRadius] = useState<PrdBlastRadius>('contained');
  const [enhancing, setEnhancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAnother, setSubmitAnother] = useState(false);
  const [isQuickMode, setIsQuickMode] = useState(false);
  const [quickText, setQuickText] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

  // Local project selection — defaults to activeProjectId when modal opens
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

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
  // Voice input
  // ---------------------------------------------------------------------------

  const {
    isSupported: voiceSupported,
    isListening,
    startListening,
    stopListening,
    error: voiceError,
  } = useVoiceInput({
    onTranscript: (text) => {
      if (isQuickMode) {
        setQuickText(text);
      } else {
        setBody(text);
      }
    },
  });

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
    setSelectedProjectId(activeProjectId);
    setIsQuickMode(false);
    setQuickText('');
    if (mode === 'edit' && editingPrd) {
      const metadata = readPrdIssueMetadata(editingPrd.body ?? '', editingPrd.labels);
      setBody(metadata.cleanBody);
      setEstimatedComplexity(metadata.estimatedComplexity);
      setBlastRadius(metadata.blastRadius);
      setError(null);
    } else {
      setBody('');
      setEstimatedComplexity('medium');
      setBlastRadius('contained');
      setError(null);
    }
    setTimeout(() => bodyRef.current?.focus(), 50);
  }, [createIssueModalOpen, mode, editingPrd, activeProjectId]);

  useEffect(() => {
    if (createIssueModalOpen && isQuickMode) {
      setTimeout(() => quickInputRef.current?.focus(), 50);
    }
  }, [createIssueModalOpen, isQuickMode]);

  const handleClose = useCallback(() => {
    stopListening();
    void clearAttachmentSession();
    closeCreateIssueModal();
  }, [stopListening, clearAttachmentSession, closeCreateIssueModal]);

  const resetDraftForSubmitAnother = useCallback(() => {
    setBody('');
    setEstimatedComplexity('medium');
    setBlastRadius('contained');
    setError(null);
    setEnhancing(false);
    setQuickText('');
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
    setError(null);
    try {
      const result = await window.shipcode.invoke<{ body: string }>('ai:enhance-prd', {
        projectId: effectiveProjectId,
        draftBody: body,
        attachmentSessionId: sessionIdRef.current,
      });
      const metadata = readPrdIssueMetadata(result.body);
      setBody(metadata.cleanBody);
      setEstimatedComplexity(metadata.estimatedComplexity);
      setBlastRadius(metadata.blastRadius);
    } catch (err) {
      log.error('[CreateIssueModal] enhance failed', err);
      setError(clampError(err));
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
            setError(`Failed to create "${title}": ${message}`);
          } else {
            window.alert(`Failed to create issue "${title}": ${message}`);
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
      setError(null);
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
        setError(clampError(err));
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
    setError(null);
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
      setError(clampError(err));
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

  const showMicButton =
    voiceSupported &&
    mode === 'create' &&
    !submitting &&
    (isQuickMode ? quickTextEmpty : bodyIsEmpty);

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
                <span className="ml-2 text-muted">(full trace in devtools console)</span>
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

          {voiceError && voiceError !== 'no-speech' && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
              <span className="min-w-0 flex-1">
                {voiceError === 'not-allowed'
                  ? 'Microphone access denied. Check system permissions.'
                  : voiceError === 'network'
                    ? 'Speech recognition service unavailable.'
                    : 'Voice input failed. Try again.'}
              </span>
            </div>
          )}

          {mode === 'create' && isQuickMode && (
            <div className="flex flex-col gap-2">
              <Input
                ref={quickInputRef}
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
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
                    onValueChange={(value) => setSelectedProjectId(value)}
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
              onChange={(e) => setBody(e.target.value)}
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
                  onValueChange={(value) => setSelectedProjectId(value)}
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
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-secondary" title={a.fileName}>
                    {a.fileName}
                  </span>
                  <span className="shrink-0 text-muted">{formatBytes(a.sizeBytes)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.fileName}`}
                    className="shrink-0 rounded p-0.5 text-muted transition-colors hover:text-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemoveAttachment(a);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
                onCheckedChange={(checked) => setIsQuickMode(checked === true)}
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
        {showMicButton ? (
          <Button
            variant="secondary"
            size="icon"
            aria-label={isListening ? 'Stop recording' : 'Start voice input'}
            onClick={isListening ? stopListening : startListening}
            className={cn(isListening && 'border-danger/40 bg-danger/10 hover:bg-danger/20')}
          >
            {isListening ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
                <Square size={14} />
              </span>
            ) : (
              <Mic size={16} />
            )}
          </Button>
        ) : (
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
        )}
      </ModalFooter>
    </Modal>
  );
}
