import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import log from 'electron-log/renderer';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_SETTINGS,
  PRD_REQUIRED_HEADINGS,
  bodyHasRequiredPrdSections,
  type AppSettings,
  type GitHubIssueCacheRecord,
  type StagedPrdAttachment,
} from '@shipcode/shared';
import { useAppStore } from '../stores/app-store';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Sparkles,
  Textarea,
  Trash2,
} from '@shipcode/ui';

/**
 * Derive a GitHub issue title from a PRD body. Prefers the first `# ` heading,
 * falls back to the first non-empty line. Truncated to 80 chars so we never
 * ship a runaway title to the API.
 */
function deriveTitleFromBody(body: string): string {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => line.startsWith('# '));
  const raw = heading ? heading.replace(/^#\s+/, '').replace(/^PRD:\s*/i, '') : (lines[0] ?? '');
  return raw.slice(0, 80).trim();
}

/**
 * Clamp an error message to a single line + 280 chars so we never dump
 * multi-KB stderr (or an echoed prompt) into the renderer.
 */
function clampError(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n')[0].slice(0, 280);
  if (typeof err === 'string') return err.split('\n')[0].slice(0, 280);
  return 'Unknown error';
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function isLikelyImageFile(file: File & { path?: string }): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

function getFilePath(file: File & { path?: string }): string | null {
  return typeof file.path === 'string' && file.path.length > 0 ? file.path : null;
}

export function CreateIssueModal() {
  const queryClient = useQueryClient();
  const { createIssueModalOpen, closeCreateIssueModal, activeProjectId, editingPrd, selectIssue } =
    useAppStore();
  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
  });

  const [body, setBody] = useState('');
  const [enhancing, setEnhancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAnother, setSubmitAnother] = useState(false);
  const [attachments, setAttachments] = useState<StagedPrdAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentSessionIdRef = useRef<string | null>(null);
  const attachmentSessionPromiseRef = useRef<Promise<string | null> | null>(null);
  const attachmentSessionTokenRef = useRef(0);

  const mode: 'create' | 'edit' = editingPrd ? 'edit' : 'create';

  useEffect(() => {
    if (!createIssueModalOpen) return;
    if (mode === 'edit' && editingPrd) {
      setBody(editingPrd.body);
    } else {
      setBody('');
    }
    setError(null);
    const focusTimer = window.setTimeout(() => bodyRef.current?.focus(), 50);
    return () => window.clearTimeout(focusTimer);
  }, [createIssueModalOpen, mode, editingPrd]);

  const editBodyValid = bodyHasRequiredPrdSections(body);
  const missingSections = useMemo(
    () => PRD_REQUIRED_HEADINGS.filter((heading) => !body.includes(heading)),
    [body],
  );
  const clampedError = useMemo(() => (error ? clampError(error) : null), [error]);
  const derivedTitle = useMemo(() => deriveTitleFromBody(body), [body]);
  const plannerModel = settings?.plannerModel ?? DEFAULT_SETTINGS.plannerModel;
  const plannerMaxTurns = settings?.plannerMaxTurns ?? DEFAULT_SETTINGS.plannerMaxTurns;

  if (!activeProjectId) return null;

  const setAttachmentSession = (next: string | null) => {
    attachmentSessionIdRef.current = next;
  };

  const clearAttachmentState = async () => {
    attachmentSessionTokenRef.current += 1;
    attachmentSessionPromiseRef.current = null;

    const currentSessionId = attachmentSessionIdRef.current;
    setAttachmentSession(null);
    setAttachments([]);

    if (currentSessionId) {
      await window.shipcode
        .invoke('prd-attachments:clear', {
          projectId: activeProjectId,
          attachmentSessionId: currentSessionId,
        })
        .catch(() => {});
    }
  };

  const ensureAttachmentSession = async (): Promise<string | null> => {
    const currentSessionId = attachmentSessionIdRef.current;
    if (currentSessionId) return currentSessionId;
    if (attachmentSessionPromiseRef.current) return attachmentSessionPromiseRef.current;

    const token = ++attachmentSessionTokenRef.current;
    const pending = window.shipcode
      .invoke<{ attachmentSessionId: string }>('prd-attachments:create-session', {
        projectId: activeProjectId,
      })
      .then(async (result) => {
        attachmentSessionPromiseRef.current = null;
        if (attachmentSessionTokenRef.current !== token) {
          await window.shipcode
            .invoke('prd-attachments:clear', {
              projectId: activeProjectId,
              attachmentSessionId: result.attachmentSessionId,
            })
            .catch(() => {});
          return null;
        }
        setAttachmentSession(result.attachmentSessionId);
        return result.attachmentSessionId;
      })
      .catch((err) => {
        attachmentSessionPromiseRef.current = null;
        throw err;
      });

    attachmentSessionPromiseRef.current = pending;
    return pending;
  };

  const ingestFiles = async (files: FileList | File[]) => {
    if (mode === 'edit') return;
    const candidates = Array.from(files)
      .map((file) => file as File & { path?: string })
      .filter(isLikelyImageFile)
      .map(getFilePath)
      .filter((value): value is string => Boolean(value));

    if (!candidates.length) {
      setError('Drop PNG, JPEG, GIF, or WebP images.');
      return;
    }

    setError(null);

    try {
      const sessionId = await ensureAttachmentSession();
      if (!sessionId) return;
      const result = await window.shipcode.invoke<{ attachments: StagedPrdAttachment[] }>(
        'prd-attachments:stage',
        {
          projectId: activeProjectId,
          attachmentSessionId: sessionId,
          paths: candidates,
        },
      );
      setAttachments(result.attachments);
    } catch (err) {
      log.error('[CreateIssueModal] attachment stage failed', err);
      setError(clampError(err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setDragActive(false);
    }
  };

  const handleEnhance = async () => {
    if (!activeProjectId) return;
    setEnhancing(true);
    setError(null);
    try {
      const sessionId = await ensureAttachmentSession();
      if (!sessionId) return;
      const result = await window.shipcode.invoke<{ body: string }>('ai:enhance-prd', {
        projectId: activeProjectId,
        draftBody: body,
        attachmentSessionId: sessionId,
      });
      setBody(result.body);
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

    setSubmitting(true);
    setError(null);

    try {
      if (mode === 'edit' && editingPrd) {
        await window.shipcode.invoke('github:edit-issue-body', {
          projectId: activeProjectId,
          issueNumber: editingPrd.issueNumber,
          body,
        });
        await queryClient.invalidateQueries({ queryKey: ['github-issues'] });
      } else {
        const created = await window.shipcode.invoke<{
          issue: GitHubIssueCacheRecord;
          projectAttachWarning: string | null;
        }>('github:create-issue', {
          projectId: activeProjectId,
          title: derivedTitle,
          body,
        });
        await queryClient.invalidateQueries({ queryKey: ['github-issues'] });

        try {
          await window.shipcode.invoke('github:start-issue', {
            projectId: activeProjectId,
            issueNumber: created.issue.issueNumber,
          });
        } catch (startErr) {
          log.error('[CreateIssueModal] start-issue failed', startErr);
        }

        if (submitAnother) {
          await clearAttachmentState();
          setBody('');
          setSubmitting(false);
          return;
        }

        selectIssue(created.issue);
        if (created.projectAttachWarning) {
          await clearAttachmentState();
          setError(
            `Issue #${created.issue.issueNumber} created, but couldn't add to project board: ${created.projectAttachWarning}`,
          );
          setSubmitting(false);
          return;
        }

        await clearAttachmentState();
      }

      closeCreateIssueModal();
    } catch (err) {
      log.error('[CreateIssueModal] submit failed', err);
      setError(clampError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    void clearAttachmentState();
    closeCreateIssueModal();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
    if (event.metaKey && event.key === 'Enter') {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const bodyIsEmpty = body.trim().length === 0;
  const titleMissing = mode === 'create' && !derivedTitle;
  const submitDisabled =
    mode === 'edit'
      ? !editBodyValid || submitting || enhancing
      : titleMissing || bodyIsEmpty || submitting || enhancing;

  const submitLabel = submitting
    ? mode === 'edit'
      ? 'Saving...'
      : 'Creating & planning...'
    : mode === 'edit'
      ? 'Save'
      : 'Create Plan';

  return (
    <Dialog
      open={createIssueModalOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="max-w-[760px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit PRD' : 'New Issue'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="issue-body" className="text-xs text-secondary">
              What do you want to build?
            </Label>
            <Textarea
              ref={bodyRef}
              id="issue-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                mode === 'create' ? 'Describe what you want to build...' : 'PRD markdown...'
              }
              rows={22}
              className={mode === 'edit' ? 'font-mono text-xs' : 'text-[13px]'}
              disabled={enhancing}
            />
          </div>

          {mode === 'create' && (
            <div className="rounded-md border border-border bg-tertiary/40 p-3">
              <div
                className={[
                  'flex cursor-pointer flex-col gap-2 rounded-md border border-dashed px-3 py-4 transition-colors',
                  dragActive
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background/40 hover:border-primary/70 hover:bg-primary/5',
                ].join(' ')}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void ingestFiles(event.dataTransfer.files);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-primary">
                      Drop image files here
                    </div>
                    <div className="mt-1 text-xs text-secondary">
                      Staged attachments stay local to this modal. Write PRD will block them until
                      ShipCode has a real multimodal CLI transport.
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Add images
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = event.target.files;
                    if (files && files.length > 0) void ingestFiles(files);
                  }}
                />
              </div>

              <div className="mt-3 rounded-md border border-border bg-background/50 px-3 py-2 text-xs text-secondary">
                Write PRD uses provider <span className="text-primary">Claude CLI</span>, model{' '}
                <span className="text-primary">{plannerModel}</span>, and effort{' '}
                <span className="text-primary">{plannerMaxTurns} turns</span>.
              </div>

              {attachments.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-secondary">
                    Staged attachments
                  </div>
                  <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-primary">{attachment.name}</div>
                          <div className="text-[11px] text-muted">
                            {attachment.mimeType} · {formatAttachmentSize(attachment.size)}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="shrink-0"
                          aria-label={`Remove ${attachment.name}`}
                          onClick={async () => {
                            try {
                              const sessionId = await ensureAttachmentSession();
                              if (!sessionId) return;
                              const result = await window.shipcode.invoke<{
                                attachments: StagedPrdAttachment[];
                              }>('prd-attachments:remove', {
                                projectId: activeProjectId,
                                attachmentSessionId: sessionId,
                                attachmentId: attachment.id,
                              });
                              setAttachments(result.attachments);
                            } catch (err) {
                              log.error('[CreateIssueModal] attachment remove failed', err);
                              setError(clampError(err));
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {mode === 'edit' && !editBodyValid && body.length > 0 && (
            <div className="max-h-20 overflow-y-auto rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
              Missing required sections: {missingSections.join(', ')}
            </div>
          )}

          {clampedError && (
            <div className="max-h-12 overflow-hidden rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
              <span className="line-clamp-1">{clampedError}</span>
              <span className="ml-2 text-muted">(full trace in devtools console)</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={handleClose} disabled={submitting || enhancing}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleEnhance}
            disabled={enhancing || submitting || bodyIsEmpty}
            title="Let AI structure your idea into a full PRD using this repo's writing-prds skill"
          >
            <Sparkles size={14} />
            {enhancing ? 'Enhancing...' : 'Enhance with AI'}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitDisabled}
            aria-label={mode === 'edit' ? 'Save PRD' : undefined}
          >
            {submitLabel}
          </Button>
          {mode === 'create' && (
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted">
              <Checkbox
                checked={submitAnother}
                onChange={(event) => setSubmitAnother(event.target.checked)}
              />
              Submit another
            </label>
          )}
          <span className="ml-auto text-[11px] text-muted">⌘↩ to submit</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
