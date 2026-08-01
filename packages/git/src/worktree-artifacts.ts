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

async function assertArtifactRealPath(worktreePath: string, absolutePath: string): Promise<void> {
  const [rootReal, targetReal] = await Promise.all([
    fs.realpath(path.resolve(worktreePath)),
    fs.realpath(absolutePath),
  ]);
  const relative = path.relative(rootReal, targetReal);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`artifact path escapes worktree through a symlink: ${absolutePath}`);
  }
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
        await assertArtifactRealPath(worktreePath, absolutePath);
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

type PruneOutcome = { kind: 'removed' } | { kind: 'missing' } | { kind: 'failed'; error: string };

/**
 * Never rejects: every per-artifact failure is reported as an outcome so one bad
 * entry cannot abort the siblings running alongside it.
 */
async function pruneArtifact(worktreePath: string, absolutePath: string): Promise<PruneOutcome> {
  try {
    await fs.lstat(absolutePath);
    await assertArtifactRealPath(worktreePath, absolutePath);
    await fs.rm(absolutePath, { force: true, recursive: true });
    return { kind: 'removed' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'missing' };
    return {
      kind: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** True when one target sits inside another, e.g. `dist` and `dist/assets`. */
function hasNestedTargets(absolutePaths: string[]): boolean {
  return absolutePaths.some((candidate) =>
    absolutePaths.some((other) => candidate.startsWith(`${other}${path.sep}`)),
  );
}

export async function pruneWorktreeArtifacts(
  worktreePath: string,
  artifactPaths: readonly string[] = DEFAULT_WORKTREE_ARTIFACT_PATHS,
): Promise<WorktreeArtifactCleanupResult> {
  // Resolve — and therefore validate — every path before touching the disk, so
  // a rejected path still aborts the call without leaving a partial cleanup.
  const targets = artifactPaths.map((relativePath) => ({
    relativePath,
    absolutePath: resolveArtifactPath(worktreePath, relativePath),
  }));

  // The configured artifacts are sibling top-level directories, so removing them
  // is independent work and the slowest one (node_modules) no longer gates the
  // rest. Nested targets are *not* independent — a recursive parent removal also
  // takes out its child — so those stay in the caller's order.
  const outcomes: PruneOutcome[] = [];
  if (hasNestedTargets(targets.map((target) => target.absolutePath))) {
    for (const target of targets) {
      outcomes.push(await pruneArtifact(worktreePath, target.absolutePath));
    }
  } else {
    outcomes.push(
      ...(await Promise.all(
        targets.map((target) => pruneArtifact(worktreePath, target.absolutePath)),
      )),
    );
  }

  const removed: string[] = [];
  const missing: string[] = [];
  const failed: Array<{ relativePath: string; error: string }> = [];

  outcomes.forEach((outcome, index) => {
    const { relativePath } = targets[index];
    if (outcome.kind === 'removed') removed.push(relativePath);
    else if (outcome.kind === 'missing') missing.push(relativePath);
    else failed.push({ relativePath, error: outcome.error });
  });

  return { removed, missing, failed };
}
