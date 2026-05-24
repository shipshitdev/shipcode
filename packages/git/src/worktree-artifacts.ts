import fs from 'node:fs/promises';
import path from 'node:path';

export interface WorktreeArtifact {
  relativePath: string;
  absolutePath: string;
}

export interface WorktreeArtifactCleanupResult {
  removed: string[];
  missing: string[];
  failed: Array<{ relativePath: string; error: string }>;
}

export const DEFAULT_WORKTREE_ARTIFACT_PATHS = [
  'node_modules',
  '.next',
  '.turbo',
  '.vite',
  '.cache',
  '.parcel-cache',
  '.nyc_output',
  'dist',
  'build',
  'out',
  'coverage',
  'playwright-report',
  'test-results',
  'logs',
  '.shipcode/qa',
] as const;

function resolveArtifactPath(worktreePath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`artifact path must be relative: ${relativePath}`);
  }

  const root = path.resolve(worktreePath);
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);

  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`)) {
    throw new Error(`artifact path escapes worktree: ${relativePath}`);
  }

  return target;
}

export async function listWorktreeArtifacts(
  worktreePath: string,
  artifactPaths: readonly string[] = DEFAULT_WORKTREE_ARTIFACT_PATHS,
): Promise<WorktreeArtifact[]> {
  const artifacts = await Promise.all(
    artifactPaths.map(async (relativePath): Promise<WorktreeArtifact | null> => {
      const absolutePath = resolveArtifactPath(worktreePath, relativePath);
      try {
        await fs.lstat(absolutePath);
        return { relativePath, absolutePath };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return null;
        throw error;
      }
    }),
  );

  return artifacts.flatMap((artifact) => (artifact ? [artifact] : []));
}

export async function pruneWorktreeArtifacts(
  worktreePath: string,
  artifactPaths: readonly string[] = DEFAULT_WORKTREE_ARTIFACT_PATHS,
): Promise<WorktreeArtifactCleanupResult> {
  const removed: string[] = [];
  const missing: string[] = [];
  const failed: Array<{ relativePath: string; error: string }> = [];

  for (const relativePath of artifactPaths) {
    const absolutePath = resolveArtifactPath(worktreePath, relativePath);
    try {
      await fs.lstat(absolutePath);
      await fs.rm(absolutePath, { force: true, recursive: true });
      removed.push(relativePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        missing.push(relativePath);
        continue;
      }
      failed.push({
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { removed, missing, failed };
}
