import type { Project, StagedPrdAttachment } from '@shipcode/shared';
import {
  Button,
  cn,
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
  const {
    instantFixModalOpen,
    closeInstantFixModal,
    addInstantPane,
    openTerminalSessions,
    instantFixModalDefaultCli,
  } = useAppStore();

  const [prompt, setPrompt] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [cli, setCli] = useState<'claude' | 'codex'>('claude');
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
      sessionIdRef.current = null;
      setCli(instantFixModalDefaultCli ?? 'claude');
      if (activeProjectId && projects.some((p) => p.id === activeProjectId)) {
        setSelectedProjectId(activeProjectId);
      } else if (projects.length > 0) {
        setSelectedProjectId(projects[0].id);
      }
    }
  }, [instantFixModalOpen, activeProjectId, projects, instantFixModalDefaultCli]);

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
    const result = await window.shipcode.invoke<{ sessionId: string }>(
      'prd-attachments:create-session',
      { senderId: 'instant-fix', projectId: selectedProjectId ?? '__instant__' },
    );
    sessionIdRef.current = result.sessionId;
    return result.sessionId;
  }, [selectedProjectId]);

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

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || !selectedProjectId) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await window.shipcode.invoke<{ threadId: string }>('instant:run', {
        projectId: selectedProjectId,
        prompt: prompt.trim(),
        scope: 'project',
        cli,
        attachmentSessionId: sessionIdRef.current ?? undefined,
      });

      addInstantPane(result.threadId);
      openTerminalSessions();
      closeInstantFixModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [prompt, selectedProjectId, cli, addInstantPane, openTerminalSessions, closeInstantFixModal]);

  return (
    <Modal open={instantFixModalOpen} onClose={closeInstantFixModal} title="New Terminal Session">
      <div className="flex flex-col gap-4">
        {/* Prompt + drop zone */}
        <section
          aria-label="Prompt and file drop zone"
          className={cn(
            'rounded-lg border border-border transition-colors',
            dragActive && 'border-accent bg-accent/5',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Textarea
            placeholder="Describe what to fix..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            autoFocus
            className="border-0 focus-visible:ring-0 resize-none"
          />

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-2">
              {attachments.map((att) => (
                <div key={att.originalPath} className="relative group">
                  <img
                    src={`file://${att.stagedPath}`}
                    alt={att.fileName}
                    className="h-16 w-16 rounded border border-border object-cover"
                  />
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-danger text-white"
                    onClick={() => void removeAttachment(att)}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* CLI + Project row */}
        <div className="flex gap-3">
          <Select value={cli} onValueChange={(v) => setCli(v as 'claude' | 'codex')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="codex">Codex</SelectItem>
            </SelectContent>
          </Select>
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
        <Button
          onClick={handleSubmit}
          disabled={!prompt.trim() || !selectedProjectId || isSubmitting}
        >
          {isSubmitting ? 'Starting...' : 'Run'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
