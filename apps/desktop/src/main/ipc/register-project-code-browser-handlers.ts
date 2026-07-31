import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { GitService } from '@shipcode/git';
import type {
  CodeFileContent,
  CodeTreeEntry,
  DiffRecord,
  GitVisualizerData,
  Project,
} from '@shipcode/shared';
import { clampError } from '@shipcode/shared';
import type { IpcMainInvokeEvent } from 'electron';

import log from '../logger.service';
import { enrichProjectPath } from './helpers';
import type { IpcHandlerDeps } from './types';

const execFileAsync = promisify(execFile);

interface RegisterProjectCodeBrowserHandlersOptions {
  ipcMain: IpcHandlerDeps['ipcMain'];
  queries: IpcHandlerDeps['queries'];
  buildGitVisualizerData: (
    project: Project,
    queries: IpcHandlerDeps['queries'],
  ) => Promise<GitVisualizerData>;
  parseDiffRecords: (diff: string, threadId: string) => DiffRecord[];
}

export function registerProjectCodeBrowserHandlers({
  ipcMain,
  queries,
  buildGitVisualizerData,
  parseDiffRecords,
}: RegisterProjectCodeBrowserHandlersOptions): void {
  const handleCodeBrowser = <TArgs extends unknown[], TResult>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...(args as TArgs));
      } catch (error) {
        log.error(`[${channel}]`, error);
        throw new Error(clampError(error));
      }
    });
  };

  const CODE_TREE_IGNORE = new Set([
    '.git',
    'node_modules',
    '.turbo',
    '.next',
    '.vite',
    '.cache',
    'dist',
    'build',
    'out',
    'coverage',
    '.DS_Store',
  ]);
  const CODE_FILE_MAX_BYTES = 512 * 1024;

  /**
   * Resolve a relative path under a worktree and reject symlink escapes.
   * String prefix checks alone are insufficient: `fs.readFile` follows
   * symlinks, so a worktree-internal link to `/etc/passwd` would otherwise
   * be readable via `code:read-file`.
   */
  async function resolveWithinWorktree(
    worktreePath: string,
    relativePath: string,
  ): Promise<string> {
    const normalizedWorktree = path.resolve(worktreePath);
    let worktreeReal: string;
    try {
      worktreeReal = await fsp.realpath(normalizedWorktree);
    } catch {
      throw new Error('Worktree path does not exist');
    }

    const candidate = path.resolve(worktreeReal, relativePath ?? '.');
    // Lexical check first (fast reject for `../` escapes before any I/O).
    if (candidate !== worktreeReal && !candidate.startsWith(`${worktreeReal}${path.sep}`)) {
      throw new Error('Path escapes worktree');
    }

    try {
      const realTarget = await fsp.realpath(candidate);
      if (realTarget !== worktreeReal && !realTarget.startsWith(`${worktreeReal}${path.sep}`)) {
        throw new Error('Path escapes worktree');
      }
      return realTarget;
    } catch (error) {
      if (error instanceof Error && error.message === 'Path escapes worktree') throw error;
      // Target may not exist yet (e.g. listing empty / missing leaf). Validate
      // the nearest existing ancestor stays inside the worktree.
      let cursor = path.dirname(candidate);
      while (cursor.startsWith(worktreeReal)) {
        try {
          const realCursor = await fsp.realpath(cursor);
          if (realCursor !== worktreeReal && !realCursor.startsWith(`${worktreeReal}${path.sep}`)) {
            throw new Error('Path escapes worktree');
          }
          return candidate;
        } catch (inner) {
          if (inner instanceof Error && inner.message === 'Path escapes worktree') throw inner;
          if (cursor === worktreeReal) break;
          cursor = path.dirname(cursor);
        }
      }
      throw new Error('Path escapes worktree');
    }
  }

  async function assertWorktreeBelongsToProject(
    project: Project,
    worktreePath: string,
  ): Promise<void> {
    const normalizedWorktree = path.resolve(worktreePath);
    const projectPath = path.resolve(project.path);
    if (normalizedWorktree === projectPath) return;
    const data = await buildGitVisualizerData(project, queries);
    const known = data.worktrees.some((w) => path.resolve(w.path) === normalizedWorktree);
    if (!known) {
      throw new Error('Worktree not associated with this project');
    }
  }

  handleCodeBrowser(
    'code:list-tree',
    async (
      _event,
      {
        projectId,
        worktreePath,
        relativePath,
      }: { projectId: string; worktreePath: string; relativePath?: string },
    ): Promise<CodeTreeEntry[]> => {
      const project = enrichProjectPath(queries.projects.getById(projectId));
      if (!project) throw new Error(`Project ${projectId} not found`);
      await assertWorktreeBelongsToProject(project, worktreePath);

      const dirPath = await resolveWithinWorktree(worktreePath, relativePath ?? '.');
      const dirStat = await fsp.stat(dirPath).catch(() => null);
      if (!dirStat?.isDirectory()) {
        throw new Error('Not a directory');
      }

      const git = new GitService(project.path);
      const status = await git.getStatus(worktreePath).catch(() => null);
      const isDirty = status?.isDirty ?? false;

      let modifiedSet = new Set<string>();
      if (isDirty) {
        try {
          const diff = await git.getDiffStat(worktreePath);
          modifiedSet = new Set(
            diff.split('\n').flatMap((line) => {
              const candidate = line.split('|')[0]?.trim();
              return candidate && !candidate.startsWith(' ') ? [candidate] : [];
            }),
          );
        } catch {
          modifiedSet = new Set();
        }
      }
      const modifiedPaths = [...modifiedSet];

      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      const result = await Promise.all(
        entries.flatMap((entry) => {
          if (CODE_TREE_IGNORE.has(entry.name)) return [];
          const entryRelative = path.join(relativePath ?? '', entry.name).replace(/\\/g, '/');
          const isFile = entry.isFile();
          return [
            (async (): Promise<CodeTreeEntry> => {
              let sizeBytes: number | null = null;
              if (isFile) {
                try {
                  const stat = await fsp.stat(path.join(dirPath, entry.name));
                  sizeBytes = stat.size;
                } catch {
                  sizeBytes = null;
                }
              }
              return {
                name: entry.name,
                relativePath: entryRelative,
                type: isFile ? 'file' : 'dir',
                sizeBytes,
                isModified: isFile
                  ? modifiedSet.has(entryRelative)
                  : isDirty && modifiedPaths.some((p) => p.startsWith(`${entryRelative}/`)),
              };
            })(),
          ];
        }),
      );

      return result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },
  );

  handleCodeBrowser(
    'code:read-file',
    async (
      _event,
      {
        projectId,
        worktreePath,
        relativePath,
      }: { projectId: string; worktreePath: string; relativePath: string },
    ): Promise<CodeFileContent> => {
      const project = enrichProjectPath(queries.projects.getById(projectId));
      if (!project) throw new Error(`Project ${projectId} not found`);
      await assertWorktreeBelongsToProject(project, worktreePath);

      const filePath = await resolveWithinWorktree(worktreePath, relativePath);
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error('Not a file');

      const buffer = await fsp.readFile(filePath);
      const looksBinary = buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
      if (looksBinary) {
        return {
          relativePath,
          content: '',
          isBinary: true,
          sizeBytes: stat.size,
          truncated: false,
        };
      }
      const truncated = buffer.length > CODE_FILE_MAX_BYTES;
      const slice = truncated ? buffer.subarray(0, CODE_FILE_MAX_BYTES) : buffer;
      return {
        relativePath,
        content: slice.toString('utf8'),
        isBinary: false,
        sizeBytes: stat.size,
        truncated,
      };
    },
  );

  handleCodeBrowser(
    'code:file-diff',
    async (
      _event,
      {
        projectId,
        worktreePath,
        relativePath,
      }: { projectId: string; worktreePath: string; relativePath: string },
    ): Promise<DiffRecord | null> => {
      const project = enrichProjectPath(queries.projects.getById(projectId));
      if (!project) throw new Error(`Project ${projectId} not found`);
      await assertWorktreeBelongsToProject(project, worktreePath);
      await resolveWithinWorktree(worktreePath, relativePath);

      try {
        const { stdout } = await execFileAsync('git', ['diff', 'HEAD', '--', relativePath], {
          cwd: worktreePath,
          maxBuffer: 8 * 1024 * 1024,
        });
        const records = parseDiffRecords(stdout, projectId);
        return records[0] ?? null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`[code:file-diff] failed: ${message}`);
        return null;
      }
    },
  );
}
