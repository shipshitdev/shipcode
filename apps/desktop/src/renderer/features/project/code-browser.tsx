import {
  type CodeFileContent,
  type CodeTreeEntry,
  type DiffRecord,
  formatBytes,
  type GitVisualizerData,
  type GitWorktreeSummary,
} from '@shipcode/shared';
import { SideBySideDiffViewer, SyntaxHighlightedCode } from '@shipcode/ui';
import {
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Lock,
  Palette,
  Terminal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../../query-stale-times';
import { useAppStore } from '../../stores/app-store';

function getFileIcon(name: string): LucideIcon {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'cs':
    case 'php':
    case 'vue':
    case 'svelte':
    case 'yml':
    case 'yaml':
    case 'toml':
    case 'html':
    case 'htm':
    case 'xml':
      return FileCode;
    case 'json':
    case 'jsonc':
    case 'json5':
      return FileJson;
    case 'md':
    case 'mdx':
    case 'txt':
    case 'log':
      return FileText;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
    case 'webp':
    case 'avif':
      return FileImage;
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
      return Terminal;
    case 'lock':
      return Lock;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return Palette;
    default:
      return File;
  }
}

const EMPTY_WORKTREES: GitWorktreeSummary[] = [];

type ViewMode = 'source' | 'diff';

interface TreeNodeProps {
  projectId: string;
  worktreePath: string;
  entry: CodeTreeEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (entry: CodeTreeEntry) => void;
}

function TreeNode({
  projectId,
  worktreePath,
  entry,
  depth,
  selectedPath,
  onSelect,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isDir = entry.type === 'dir';
  const isSelected = !isDir && selectedPath === entry.relativePath;

  const { data: children, isLoading } = useQuery<CodeTreeEntry[]>({
    queryKey: ['code-tree', projectId, worktreePath, entry.relativePath],
    queryFn: () =>
      window.shipcode.invoke('code:list-tree', {
        projectId,
        worktreePath,
        relativePath: entry.relativePath,
      }),
    enabled: isDir && expanded,
    staleTime: 10_000,
  });

  return (
    <div className="text-xs">
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          if (isDir) {
            setExpanded((prev) => !prev);
          } else {
            onSelect(entry);
          }
        }}
        className={cn(
          'flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-secondary hover:bg-tertiary/40',
          isSelected && 'bg-tertiary text-primary',
        )}
        style={{ paddingLeft: 6 + depth * 10 }}
        title={entry.relativePath}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          ) : (
            <ChevronRight size={11} className="shrink-0 opacity-60" />
          )
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        {isDir ? (
          expanded ? (
            <FolderOpen
              size={12}
              className={cn(
                'shrink-0',
                entry.isModified ? 'text-amber-500' : 'text-muted-foreground',
              )}
            />
          ) : (
            <Folder
              size={12}
              className={cn(
                'shrink-0',
                entry.isModified ? 'text-amber-500' : 'text-muted-foreground',
              )}
            />
          )
        ) : (
          (() => {
            const Icon = getFileIcon(entry.name);
            return (
              <Icon
                size={12}
                className={cn(
                  'shrink-0',
                  entry.isModified ? 'text-amber-500' : 'text-muted-foreground',
                )}
              />
            );
          })()
        )}
        <span className={cn('truncate', entry.isModified && 'text-amber-500')}>{entry.name}</span>
        {entry.isModified && (
          <span className="ml-auto shrink-0 text-[10px] font-medium text-amber-500">M</span>
        )}
      </Button>
      {isDir && expanded && (
        <div>
          {isLoading && (
            <div
              className="flex items-center gap-1 py-0.5 text-[10px] text-muted-foreground"
              style={{ paddingLeft: 6 + (depth + 1) * 10 }}
            >
              <Loader2 size={10} className="animate-spin" />
              loading
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.relativePath}
              projectId={projectId}
              worktreePath={worktreePath}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileViewer({
  projectId,
  worktreePath,
  relativePath,
}: {
  projectId: string;
  worktreePath: string;
  relativePath: string;
}) {
  const [mode, setMode] = useState<ViewMode>('source');

  const { data: file, isLoading: fileLoading } = useQuery<CodeFileContent>({
    queryKey: ['code-file', projectId, worktreePath, relativePath],
    queryFn: () =>
      window.shipcode.invoke('code:read-file', { projectId, worktreePath, relativePath }),
    staleTime: 5_000,
  });

  const { data: diff, isLoading: diffLoading } = useQuery<DiffRecord | null>({
    queryKey: ['code-diff', projectId, worktreePath, relativePath],
    queryFn: () =>
      window.shipcode.invoke('code:file-diff', { projectId, worktreePath, relativePath }),
    enabled: mode === 'diff',
    staleTime: 5_000,
  });

  const hasDiff = !!diff?.diffContent;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-secondary/30 px-3 py-1.5">
        <div className="flex items-center gap-2 truncate text-xs text-secondary">
          {(() => {
            const Icon = getFileIcon(relativePath);
            return <Icon size={12} className="shrink-0 text-muted-foreground" />;
          })()}
          <span className="truncate font-mono">{relativePath}</span>
          {file && !file.isBinary && (
            <span className="text-[10px] text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-6 px-2 text-xs', mode === 'source' && 'bg-tertiary text-primary')}
            onClick={() => setMode('source')}
          >
            Source
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-6 px-2 text-xs', mode === 'diff' && 'bg-tertiary text-primary')}
            onClick={() => setMode('diff')}
          >
            Diff
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {mode === 'source' ? (
          fileLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <Loader2 size={14} className="mr-2 animate-spin" />
              loading file
            </div>
          ) : !file ? (
            <div className="p-4 text-xs text-muted-foreground">No file selected</div>
          ) : file.isBinary ? (
            <div className="p-4 text-xs text-muted-foreground">
              Binary file ({formatBytes(file.sizeBytes)}), preview unavailable.
            </div>
          ) : (
            <>
              {file.truncated && (
                <div className="border-b border-border bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-500">
                  File truncated, showing first {formatBytes(file.content.length)} of{' '}
                  {formatBytes(file.sizeBytes)}.
                </div>
              )}
              <SyntaxHighlightedCode code={file.content} filePath={relativePath} className="p-3" />
            </>
          )
        ) : diffLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Loader2 size={14} className="mr-2 animate-spin" />
            loading diff
          </div>
        ) : hasDiff && diff ? (
          <SideBySideDiffViewer diffs={[diff]} className="h-full" />
        ) : (
          <div className="p-4 text-xs text-muted-foreground">
            No uncommitted changes for this file.
          </div>
        )}
      </div>
    </div>
  );
}

export function CodeBrowser() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const { data, isLoading: worktreesLoading } = useQuery<GitVisualizerData>({
    queryKey: ['git-visualizer-data', activeProjectId],
    queryFn: () => window.shipcode.invoke('git:visualizer-data', { projectId: activeProjectId }),
    enabled: !!activeProjectId,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const worktrees: GitWorktreeSummary[] = data?.worktrees ?? EMPTY_WORKTREES;

  useEffect(() => {
    if (!worktrees.length) {
      setSelectedWorktreePath(null);
      return;
    }
    setSelectedWorktreePath((current) =>
      current && worktrees.some((w) => w.path === current)
        ? current
        : (worktrees.find((w) => w.kind === 'main')?.path ?? worktrees[0]?.path ?? null),
    );
  }, [worktrees]);

  const activeWorktree = useMemo(
    () => worktrees.find((w) => w.path === selectedWorktreePath) ?? null,
    [worktrees, selectedWorktreePath],
  );

  const { data: rootEntries, isLoading: treeLoading } = useQuery<CodeTreeEntry[]>({
    queryKey: ['code-tree', activeProjectId, selectedWorktreePath, ''],
    queryFn: () =>
      window.shipcode.invoke('code:list-tree', {
        projectId: activeProjectId,
        worktreePath: selectedWorktreePath ?? '',
      }),
    enabled: !!activeProjectId && !!selectedWorktreePath,
    staleTime: 10_000,
  });

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Select a project to browse code.
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-secondary/20">
        <div className="shrink-0 border-b border-border px-3 py-2">
          <span className="block pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Worktree
          </span>
          {worktreesLoading ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> loading
            </div>
          ) : (
            <Select
              value={selectedWorktreePath ?? ''}
              onValueChange={(value) => {
                setSelectedWorktreePath(value || null);
                setSelectedPath(null);
              }}
            >
              <SelectTrigger className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {worktrees.map((w) => (
                  <SelectItem key={w.path} value={w.path} className="text-xs">
                    {w.kind === 'main' ? '● main' : `◐ ${w.branch}`}
                    {w.isDirty ? ' *' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {activeWorktree && (
            <div className="pt-1.5 text-[10px] text-muted-foreground">
              <div className="truncate font-mono" title={activeWorktree.branch}>
                {activeWorktree.branch}
              </div>
              <div className="truncate" title={activeWorktree.path}>
                {activeWorktree.path}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto py-1">
          {treeLoading && (
            <div className="flex items-center gap-1 px-3 py-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> loading tree
            </div>
          )}
          {selectedWorktreePath &&
            rootEntries?.map((entry) => (
              <TreeNode
                key={entry.relativePath}
                projectId={activeProjectId}
                worktreePath={selectedWorktreePath}
                entry={entry}
                depth={0}
                selectedPath={selectedPath}
                onSelect={(e) => setSelectedPath(e.relativePath)}
              />
            ))}
        </div>
      </aside>

      <main className="flex flex-1 min-w-0 flex-col bg-primary">
        {selectedPath && selectedWorktreePath ? (
          <FileViewer
            projectId={activeProjectId}
            worktreePath={selectedWorktreePath}
            relativePath={selectedPath}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            Select a file to view its contents.
          </div>
        )}
      </main>
    </div>
  );
}
