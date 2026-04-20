import {
  bodyHasRequiredPrdSections,
  buildPrdMetadataLabels,
  type GitHubIssueCacheRecord,
  PRD_REQUIRED_HEADINGS,
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
  ImageIcon,
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
  Trash2,
} from '@shipcode/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * Clamp an error message to a single line + 280 chars so we never dump
 * multi-KB stderr (or an echoed prompt) into the renderer. The full error
 * still goes to the devtools console via `console.error` in the caller.
 */
function clampError(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n')[0].slice(0, 280);
  if (typeof err === 'string') return err.split('\n')[0].slice(0, 280);
  return 'Unknown error';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CreateIssueModal() {
  const queryClient = useQueryClient();
  const {
    createIssueModalOpen,
    closeCreateIssueModal,
    activeProjectId,
    editingPrd,
    selectIssue,
    selectProject,
  } = useAppStore();
  const [body, setBody] = useState('');
  const [estimatedComplexity, setEstimatedComplexity] = useState<PrdEstimatedComplexity>('medium');
  const [blastRadius, setBlastRadius] = useState<PrdBlastRadius>('contained');
  const [enhancing, setEnhancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAnother, setSubmitAnother] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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

  const handleClose = useCallback(() => {
    void clearAttachmentSession();
    closeCreateIssueModal();
  }, [clearAttachmentSession, closeCreateIssueModal]);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const editBodyValid = bodyHasRequiredPrdSections(body);
  const missingSections = useMemo(
    () => PRD_REQUIRED_HEADINGS.filter((h) => !body.includes(h)),
    [body],
  );
  const clampedError = useMemo(() => (error ? clampError(error) : null), [error]);
  const derivedTitle = useMemo(() => deriveTitleFromBody(body), [body]);
  const metadataLabels = useMemo(
    () => ['enhancement', ...buildPrdMetadataLabels({ estimatedComplexity, blastRadius })],
    [estimatedComplexity, blastRadius],
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

  const handleSubmit = async () => {
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
        });
        await queryClient.invalidateQueries({ queryKey: ['github-issues'] });
      } else {
        const created = await window.shipcode.invoke<{
          issue: GitHubIssueCacheRecord;
          projectAttachWarning: string | null;
        }>('github:create-issue', {
          projectId: effectiveProjectId,
          title: derivedTitle,
          body,
          labels: metadataLabels,
        });
        await queryClient.invalidateQueries({ queryKey: ['github-issues'] });
        // Kick off the pipeline immediately and open the issue detail
        // so the user can watch planning start.
        try {
          await window.shipcode.invoke('github:start-issue', {
            projectId: effectiveProjectId,
            issueNumber: created.issue.issueNumber,
          });
        } catch (startErr) {
          log.error('[CreateIssueModal] start-issue failed', startErr);
          // Don't block the success path — the issue is on GitHub either way.
        }
        if (submitAnother) {
          // Reset form and stay open so the user can submit the next idea.
          setBody('');
          setSubmitting(false);
          // Clear attachments for the next submission
          void clearAttachmentSession();
          return;
        }
        if (effectiveProjectId !== activeProjectId) {
          selectProject(effectiveProjectId);
        }
        selectIssue(created.issue);
        // If best-effort board attach failed, keep the modal open with an
        // inline warning so the user actually sees it. The issue is already
        // on GitHub and is selected — they can dismiss and move on.
        if (created.projectAttachWarning) {
          setError(
            `Issue #${created.issue.issueNumber} created, but couldn't add to project board: ${created.projectAttachWarning}`,
          );
          setSubmitting(false);
          return;
        }
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
  const submitDisabled =
    mode === 'edit'
      ? !editBodyValid || submitting || enhancing
      : noProject || titleMissing || bodyIsEmpty || submitting || enhancing;

  const submitLabel = submitting
    ? mode === 'edit'
      ? 'Saving...'
      : 'Creating & planning...'
    : mode === 'edit'
      ? 'Save'
      : 'Create Plan';

  const hasAttachments = attachments.length > 0;

  return (
    <Modal
      open={createIssueModalOpen}
      onClose={handleClose}
      title={mode === 'edit' ? 'Edit PRD' : 'New Issue'}
      className="max-w-[720px]"
      onKeyDown={handleKeyDown}
    >
      <section
        aria-label="Issue content"
        className={cn(
          'flex flex-col gap-3 transition-colors',
          dragActive && 'rounded-lg ring-2 ring-accent/50 bg-accent/5',
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
              {enhancing ? 'Formatting…' : 'Format'}
            </Button>
          </div>
        )}

        {clampedError && (
          <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1">{clampedError}</span>
              <span className="ml-2 text-muted">(full trace in devtools console)</span>
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0 text-danger hover:text-danger hover:bg-danger/20"
              onClick={handleEnhance}
              disabled={enhancing || submitting || bodyIsEmpty || hasAttachments}
            >
              Retry
            </Button>
          </div>
        )}

        {attachmentErrors.length > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
            {attachmentErrors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}

        <Textarea
          ref={bodyRef}
          id="issue-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={mode === 'create' ? 'Describe what you want to build…' : 'PRD markdown...'}
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

        {/* Project + Format row — below textarea in create mode */}
        {mode === 'create' && projects.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1 w-48">
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
              {enhancing ? 'Formatting…' : 'Format'}
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
            {enhancing ? 'Formatting…' : 'Format'}
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

      <ModalFooter className="items-center border-t border-border -mx-6 px-6 pt-4">
        {mode === 'create' && (
          <Label
            htmlFor="submit-another"
            className="mr-auto flex cursor-pointer items-center gap-2 rounded-md border border-border bg-tertiary/40 px-3 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary"
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
        <Button variant="secondary" onClick={handleClose} disabled={submitting || enhancing}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={submitDisabled}
          aria-label={mode === 'edit' ? 'Save PRD' : undefined}
        >
          <span>{submitLabel}</span>
          <Keycap>⌘↩</Keycap>
        </Button>
      </ModalFooter>
    </Modal>
  );
}
