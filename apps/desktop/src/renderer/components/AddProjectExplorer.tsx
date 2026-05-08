import type { Project } from '@shipcode/shared';
import { Button, cn, Input, Modal } from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ChevronLeft, ChevronRight, Folder, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/app-store';

interface DirEntry {
  name: string;
  absolutePath: string;
}

interface ListResult {
  entries: DirEntry[];
  error: 'permission-denied' | 'not-found' | null;
}

export function AddProjectExplorer() {
  const open = useAppStore((s) => s.addProjectExplorerOpen);
  const close = useAppStore((s) => s.closeAddProjectExplorer);
  const selectProject = useAppStore((s) => s.selectProject);
  const openProjectSettingsModal = useAppStore((s) => s.openProjectSettingsModal);

  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────

  const [cwd, setCwd] = useState<string>('');
  const [cwdInitialized, setCwdInitialized] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [pathInputValue, setPathInputValue] = useState('');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const pathInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Resolve start directory ──────────────────────────────────────────

  const { data: startDir } = useQuery({
    queryKey: ['fs:resolve-start-dir'],
    queryFn: () => window.shipcode.invoke<{ resolvedPath: string }>('fs:resolve-start-dir'),
    enabled: open,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (startDir && !cwdInitialized) {
      setCwd(startDir.resolvedPath);
      setPathInputValue(startDir.resolvedPath);
      setCwdInitialized(true);
    }
  }, [startDir, cwdInitialized]);

  // ── List directories ─────────────────────────────────────────────────

  const {
    data: listing,
    isLoading,
    isFetching,
  } = useQuery<ListResult>({
    queryKey: ['fs:list-directories', cwd],
    queryFn: () => window.shipcode.invoke<ListResult>('fs:list-directories', { dirPath: cwd }),
    enabled: open && !!cwd,
    staleTime: 5_000,
  });

  const entries = listing?.entries ?? [];
  const listError = listing?.error ?? null;

  // ── Navigation helpers ───────────────────────────────────────────────

  const navigateTo = useCallback((dirPath: string) => {
    setCwd(dirPath);
    setPathInputValue(dirPath);
    setSelectedIndex(-1);
    setAddError(null);
  }, []);

  const goUp = useCallback(() => {
    if (!cwd) return;
    const parent = cwd.replace(/\/[^/]+\/?$/, '') || '/';
    if (parent !== cwd) {
      navigateTo(parent);
    }
  }, [cwd, navigateTo]);

  // ── Add project ──────────────────────────────────────────────────────

  const addProject = useMutation({
    mutationFn: () => window.shipcode.invoke<Project>('project:add', { path: cwd }),
    onSuccess: (project) => {
      close();
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      selectProject(project.id);
      openProjectSettingsModal(project.id, 'setup');
      window.shipcode
        .invoke('github:refresh-issues', { projectId: project.id, force: true })
        .catch(() => {});
    },
    onError: (err: Error) => {
      setAddError(err.message);
    },
  });

  const handleAdd = useCallback(() => {
    if (!cwd || addProject.isPending) return;
    setAddError(null);
    addProject.mutate();
  }, [cwd, addProject]);

  // ── Path input handlers ──────────────────────────────────────────────

  const handlePathSubmit = useCallback(() => {
    const trimmed = pathInputValue.trim();
    if (trimmed && trimmed !== cwd) {
      navigateTo(trimmed);
    }
    setIsEditingPath(false);
  }, [pathInputValue, cwd, navigateTo]);

  // ── Keyboard navigation ──────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const isPathInputFocused = document.activeElement === pathInputRef.current;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, entries.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === 'Enter') {
        if (isPathInputFocused) {
          handlePathSubmit();
        } else if (selectedIndex >= 0 && selectedIndex < entries.length) {
          navigateTo(entries[selectedIndex].absolutePath);
        } else {
          handleAdd();
        }
      } else if (e.key === 'Backspace' && !isPathInputFocused) {
        e.preventDefault();
        goUp();
      }
    },
    [entries, selectedIndex, goUp, handleAdd, handlePathSubmit, navigateTo],
  );

  // ── Auto-scroll selected item into view ──────────────────────────────

  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // ── Reset state on close ─────────────────────────────────────────────

  useEffect(() => {
    if (!open) {
      setCwd('');
      setCwdInitialized(false);
      setSelectedIndex(-1);
      setPathInputValue('');
      setIsEditingPath(false);
      setAddError(null);
    }
  }, [open]);

  // ── Determine if at filesystem root ──────────────────────────────────

  const isAtRoot = cwd === '/';

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add Repository"
      className="max-w-[580px] h-[480px] flex flex-col p-0 gap-0"
      headerClassName="px-4 py-3 border-b border-border"
      onKeyDown={handleKeyDown}
    >
      {/* ── Path bar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={goUp}
          disabled={isAtRoot}
          className={cn(
            'rounded p-1 transition-colors',
            isAtRoot
              ? 'text-muted-foreground cursor-not-allowed'
              : 'text-secondary hover:text-primary hover:bg-hover',
          )}
          title="Go up (Backspace)"
        >
          <ChevronLeft size={16} />
        </Button>
        <Input
          ref={pathInputRef}
          type="text"
          className="flex-1 h-8 text-sm font-mono"
          value={isEditingPath ? pathInputValue : cwd}
          onFocus={() => {
            setIsEditingPath(true);
            setPathInputValue(cwd);
          }}
          onBlur={() => {
            setIsEditingPath(false);
            setPathInputValue(cwd);
          }}
          onChange={(e) => setPathInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handlePathSubmit();
              (e.target as HTMLInputElement).blur();
            }
            // Prevent Backspace from bubbling to the modal handler
            if (e.key === 'Backspace') {
              e.stopPropagation();
            }
          }}
        />
        {isFetching && (
          <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />
        )}
      </div>

      {/* ── Directory listing ─────────────────────────────────────── */}
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
        {isLoading && !listing && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading...
          </div>
        )}

        {listError === 'permission-denied' && (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-red-500">
            <AlertCircle size={14} className="shrink-0" />
            Permission denied
          </div>
        )}

        {listError === 'not-found' && (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-red-500">
            <AlertCircle size={14} className="shrink-0" />
            Directory not found
          </div>
        )}

        {!isLoading && !listError && entries.length === 0 && (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center">No folders here</div>
        )}

        {entries.map((entry, i) => (
          <Button
            key={entry.absolutePath}
            type="button"
            variant="ghost"
            data-index={i}
            className={cn(
              'flex w-full items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors hover:bg-hover',
              i === selectedIndex && 'bg-hover text-primary',
            )}
            onClick={() => navigateTo(entry.absolutePath)}
          >
            <Folder size={14} className="shrink-0 text-muted-foreground" />
            <span className="truncate flex-1">{entry.name}</span>
            <ChevronRight size={12} className="shrink-0 text-muted-foreground opacity-60" />
          </Button>
        ))}
      </div>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        {addError && <p className="text-xs text-red-500 mb-2 line-clamp-2">{addError}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground truncate flex-1" title={cwd}>
            {cwd}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={!cwd || addProject.isPending}>
              {addProject.isPending ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={14} className="animate-spin" />
                  Adding...
                </span>
              ) : (
                'Add Repository'
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
