import { useState, useRef, useEffect, useMemo } from 'react';
import log from 'electron-log/renderer';
import { useQueryClient } from '@tanstack/react-query';
import {
  PRD_REQUIRED_HEADINGS,
  bodyHasRequiredPrdSections,
  type GitHubIssueCacheRecord,
} from '@shipcode/shared';
import { useAppStore } from '../stores/app-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Textarea,
  Label,
  Button,
  Checkbox,
  Sparkles,
} from '@shipcode/ui';

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

export function CreateIssueModal() {
  const queryClient = useQueryClient();
  const { createIssueModalOpen, closeCreateIssueModal, activeProjectId, editingPrd, selectIssue } =
    useAppStore();
  const [body, setBody] = useState('');
  const [enhancing, setEnhancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAnother, setSubmitAnother] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const mode: 'create' | 'edit' = editingPrd ? 'edit' : 'create';

  useEffect(() => {
    if (!createIssueModalOpen) return;
    if (mode === 'edit' && editingPrd) {
      setBody(editingPrd.body);
      setError(null);
    } else {
      setBody('');
      setError(null);
    }
    setTimeout(() => bodyRef.current?.focus(), 50);
  }, [createIssueModalOpen, mode, editingPrd]);

  // Edit mode: keep the PRD sections validation. Create mode: just check non-empty.
  const editBodyValid = bodyHasRequiredPrdSections(body);
  const missingSections = useMemo(
    () => PRD_REQUIRED_HEADINGS.filter((h) => !body.includes(h)),
    [body],
  );
  const clampedError = useMemo(() => (error ? clampError(error) : null), [error]);
  const derivedTitle = useMemo(() => deriveTitleFromBody(body), [body]);

  if (!activeProjectId) return null;

  const handleEnhance = async () => {
    if (!activeProjectId) return;
    setEnhancing(true);
    setError(null);
    try {
      const result = await window.shipcode.invoke<{ body: string }>('ai:enhance-prd', {
        projectId: activeProjectId,
        draftBody: body,
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
        const created = await window.shipcode.invoke<GitHubIssueCacheRecord>(
          'github:create-issue',
          {
            projectId: activeProjectId,
            title: derivedTitle,
            body,
          },
        );
        await queryClient.invalidateQueries({ queryKey: ['github-issues'] });
        // Kick off the pipeline immediately and open the issue detail
        // so the user can watch planning start.
        try {
          await window.shipcode.invoke('github:start-issue', {
            projectId: activeProjectId,
            issueNumber: created.issueNumber,
          });
        } catch (startErr) {
          log.error('[CreateIssueModal] start-issue failed', startErr);
          // Don't block the success path — the issue is on GitHub either way.
        }
        if (submitAnother) {
          // Reset form and stay open so the user can submit the next idea.
          setBody('');
          setSubmitting(false);
          return;
        }
        selectIssue(created);
      }
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
      closeCreateIssueModal();
    }
    if (e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const bodyIsEmpty = body.trim().length === 0;

  // Submit disabled logic differs by mode.
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
      ? 'Save PRD'
      : 'Create Plan';

  return (
    <Dialog
      open={createIssueModalOpen}
      onOpenChange={(open) => {
        if (!open) closeCreateIssueModal();
      }}
    >
      <DialogContent className="max-w-[720px]" onKeyDown={handleKeyDown}>
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
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                mode === 'create' ? 'Describe what you want to build…' : 'PRD markdown...'
              }
              rows={22}
              className={
                mode === 'edit' && editBodyValid
                  ? 'font-mono text-xs'
                  : mode === 'edit'
                    ? 'font-mono text-xs'
                    : 'text-[13px]'
              }
              disabled={enhancing}
            />
          </div>

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
          <Button
            variant="secondary"
            onClick={closeCreateIssueModal}
            disabled={submitting || enhancing}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleEnhance}
            disabled={enhancing || submitting || bodyIsEmpty}
            title="Let AI structure your idea into a full PRD using this repo's writing-prds skill"
          >
            <Sparkles size={14} />
            {enhancing ? 'Enhancing…' : 'Enhance with AI'}
          </Button>
          <Button onClick={handleSubmit} disabled={submitDisabled}>
            {submitLabel}
          </Button>
          {mode === 'create' && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer select-none">
              <Checkbox
                checked={submitAnother}
                onChange={(e) => setSubmitAnother(e.target.checked)}
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
