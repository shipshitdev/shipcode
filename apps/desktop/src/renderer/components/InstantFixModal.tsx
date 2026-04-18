import type { InstantFixScope, Project, StagedPrdAttachment } from '@shipcode/shared';
import {
  Button,
  cn,
  ImageIcon,
  Modal,
  ModalFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  X,
} from '@shipcode/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/app-store';

export function InstantFixModal() {
  const { instantFixModalOpen, closeInstantFixModal, addInstantPane, openInstant } = useAppStore();

  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState<InstantFixScope>('project');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [cli, setCli] = useState<'claude' | 'codex'>('claude');
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Attachments
  const [attachments, setAttachments] = useState<StagedPrdAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  // Fetch visible projects for the project picker
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke<Project[]>('project:list-visible'),
    staleTime: 30_000,
    enabled: instantFixModalOpen,
  });

  const activeProjectId = useAppStore((s) => s.activeProjectId);

  // Set default project on open
  useEffect(() => {
    if (instantFixModalOpen) {
      setPrompt('');
      setError(null);
      setAttachments([]);
      setCustomSystemPrompt('');
      sessionIdRef.current = null;
      if (activeProjectId && projects.some((p) => p.id === activeProjectId)) {
        setSelectedProjectId(activeProjectId);
        setScope('project');
      } else if (projects.length > 0) {
        setSelectedProjectId(projects[0].id);
        setScope('project');
      } else {
        setScope('user');
      }
    }
  }, [instantFixModalOpen, activeProjectId, projects]);

  // Cleanup attachment session on close
  useEffect(() => {
    if (!instantFixModalOpen && sessionIdRef.current) {
      void window.shipcode.invoke('prd-attachments:clear', {
        sessionId: sessionIdRef.current,
      });
      sessionIdRef.current = null;
    }
  }, [instantFixModalOpen]);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const projectIdForSession =
      scope === 'user' ? '__instant__' : (selectedProjectId ?? '__instant__');
    const result = await window.shipcode.invoke<{ sessionId: string }>(
      'prd-attachments:create-session',
      { senderId: 'instant-fix', projectId: projectIdForSession },
    );
    sessionIdRef.current = result.sessionId;
    return result.sessionId;
  }, [scope, selectedProjectId]);

  const ingestFiles = useCallback(
    async (files: File[]) => {
      const paths = files.map((f) => (f as File & { path: string }).path).filter(Boolean);
      if (paths.length === 0) return;
      const sessionId = await ensureSession();
      const result = await window.shipcode.invoke<{
        staged: StagedPrdAttachment[];
        errors: string[];
      }>('prd-attachments:stage', { sessionId, filePaths: paths });
      setAttachments((prev) => [...prev, ...result.staged]);
    },
    [ensureSession],
  );

  const removeAttachment = useCallback(async (attachment: StagedPrdAttachment) => {
    if (!sessionIdRef.current) return;
    await window.shipcode.invoke('prd-attachments:remove', {
      sessionId: sessionIdRef.current,
      filePath: attachment.originalPath,
    });
    setAttachments((prev) => prev.filter((a) => a.originalPath !== attachment.originalPath));
  }, []);

  // Drag-and-drop
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
      if (files.length > 0) void ingestFiles(files);
    },
    [ingestFiles],
  );

  const handleFilePickerClick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length > 0) void ingestFiles(files);
    };
    input.click();
  }, [ingestFiles]);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await window.shipcode.invoke<{ threadId: string }>('instant:run', {
        projectId: scope !== 'user' ? selectedProjectId : undefined,
        prompt: prompt.trim(),
        scope,
        cli,
        attachmentSessionId: sessionIdRef.current ?? undefined,
        customSystemPrompt: scope === 'custom' ? customSystemPrompt.trim() : undefined,
      });

      addInstantPane(result.threadId);
      openInstant();
      closeInstantFixModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    prompt,
    scope,
    selectedProjectId,
    cli,
    customSystemPrompt,
    addInstantPane,
    openInstant,
    closeInstantFixModal,
  ]);

  return (
    <Modal open={instantFixModalOpen} onClose={closeInstantFixModal} title="Instant Fix">
      <div className="flex flex-col gap-4">
        {/* Prompt */}
        <Textarea
          placeholder="Describe what to fix..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          autoFocus
        />

        {/* Scope + CLI row */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted mb-1 block">Scope</label>
            <Select value={scope} onValueChange={(v) => setScope(v as InstantFixScope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="user">User (read-only)</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted mb-1 block">CLI</label>
            <Select value={cli} onValueChange={(v) => setCli(v as 'claude' | 'codex')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Project picker (project/custom scope) */}
        {scope !== 'user' && (
          <div>
            <label className="text-xs text-muted mb-1 block">Project</label>
            <Select value={selectedProjectId ?? ''} onValueChange={setSelectedProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a project" />
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

        {/* Custom system prompt */}
        {scope === 'custom' && (
          <div>
            <label className="text-xs text-muted mb-1 block">System Prompt</label>
            <Textarea
              placeholder="Custom system instructions..."
              value={customSystemPrompt}
              onChange={(e) => setCustomSystemPrompt(e.target.value)}
              rows={3}
            />
          </div>
        )}

        {/* Security warning for user scope */}
        {scope === 'user' && (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            User scope runs in read-only mode — no file writes allowed.
          </div>
        )}

        {/* Image drop zone */}
        <div>
          <label className="text-xs text-muted mb-1 block">Screenshots (optional)</label>
          <Button
            variant="ghost"
            className={cn(
              'w-full h-20 border-2 border-dashed border-border rounded-lg flex items-center justify-center gap-2 text-muted text-xs',
              dragActive && 'border-accent bg-accent/5',
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleFilePickerClick}
          >
            <ImageIcon size={16} />
            Drop images here or click to browse
          </Button>

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {attachments.map((att) => (
                <div
                  key={att.originalPath}
                  className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-secondary"
                >
                  <span className="truncate max-w-[120px]">{att.fileName}</span>
                  <button
                    type="button"
                    className="text-muted hover:text-danger"
                    onClick={() => void removeAttachment(att)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={closeInstantFixModal}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!prompt.trim() || isSubmitting}>
          {isSubmitting ? 'Starting...' : 'Run'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
