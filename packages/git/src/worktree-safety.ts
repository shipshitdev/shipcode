import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import {
  assertGitWorkspaceIdentity,
  assertNoUnsafeSymlinkAncestors,
  canonicalizeWorktreePath,
} from '@shipcode/shared/worktree-path';
import type { SimpleGit } from 'simple-git';

const SAFE_WORKTREE_BASENAME = /^[A-Za-z0-9._-]+$/;

export interface RegisteredWorktree {
  path: string;
  branch: string | null;
}

export function assertCanonicalWorktreePath(input: string, label: string): string {
  if (!path.isAbsolute(input)) throw new Error(`${label} must be absolute (got: ${input})`);
  const resolved = path.resolve(input);
  if (resolved !== input) {
    throw new Error(`${label} contains traversal or non-canonical segments (got: ${input})`);
  }
  if (!SAFE_WORKTREE_BASENAME.test(path.basename(resolved))) {
    throw new Error(`${label} has an unsafe basename (got: ${path.basename(resolved)})`);
  }
  return resolved;
}

export function assertSafeWorktreeBranch(branch: string): void {
  const segments = branch.split('/');
  const invalid =
    !branch ||
    branch.startsWith('-') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.includes('..') ||
    branch.includes('@{') ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional Git ref validation
    /[\x00-\x20\x7f~^:?*[\]\\]/.test(branch) ||
    segments.some((segment) => !segment || segment === '.' || segment.endsWith('.lock'));
  if (invalid) throw new Error(`worktree branch is not a safe Git ref (got: ${branch})`);
}

export function parseRegisteredWorktrees(output: string): RegisteredWorktree[] {
  const worktrees: RegisteredWorktree[] = [];
  let current: RegisteredWorktree | null = null;
  const push = () => {
    if (current) worktrees.push(current);
    current = null;
  };

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      push();
      current = { path: line.slice('worktree '.length).trim(), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line
        .slice('branch '.length)
        .trim()
        .replace(/^refs\/heads\//, '');
    } else if (line === '') {
      push();
    }
  }
  push();
  return worktrees;
}

export async function listRegisteredWorktrees(git: SimpleGit): Promise<RegisteredWorktree[]> {
  return parseRegisteredWorktrees(await git.raw(['worktree', 'list', '--porcelain']));
}

export function assertWorktreeCreateTarget(expectedParent: string, targetPath: string): void {
  const parent = path.resolve(expectedParent);
  const target = assertCanonicalWorktreePath(targetPath, 'worktree create path');
  if (path.dirname(target) !== parent) {
    throw new Error(
      `worktree create path must be a direct child of its configured parent (parent: ${parent}, path: ${target})`,
    );
  }
  if (existsSync(target)) {
    throw new Error(`worktree create path already exists: ${target}`);
  }

  // Inspect EVERY lexical ancestor, not just the first existing one: `existsSync`
  // follows symlinks, so `configured -> outside` with an existing `outside/child`
  // would look like a plain directory and the intermediate link would be missed.
  assertNoUnsafeSymlinkAncestors(parent, 'worktree create parent');
}

export async function assertRegisteredWorktree(input: {
  git: SimpleGit;
  projectPath: string;
  worktreePath: string;
  branch: string;
  requireExisting?: boolean;
  allowBrokenIdentity?: boolean;
}): Promise<RegisteredWorktree> {
  const concretePath = assertCanonicalWorktreePath(input.worktreePath, 'worktree path');
  assertSafeWorktreeBranch(input.branch);
  const registered = await listRegisteredWorktrees(input.git);
  // Git reports canonical paths, so both sides are canonicalized before they are
  // compared: on macOS a caller's `/var/…` never equals Git's `/private/var/…`.
  const canonicalPath = canonicalizeWorktreePath(concretePath);
  const pathEntry = registered.find(
    (entry) => canonicalizeWorktreePath(entry.path) === canonicalPath,
  );
  if (!pathEntry) {
    const branchEntry = registered.find((entry) => entry.branch === input.branch);
    if (branchEntry) {
      throw new Error(
        `worktree branch/path mismatch (branch: ${input.branch}, registered: ${branchEntry.path}, requested: ${concretePath})`,
      );
    }
    throw new Error(`worktree path is not registered for this repository: ${concretePath}`);
  }
  if (pathEntry.branch !== input.branch) {
    throw new Error(
      `worktree branch/path mismatch (path: ${concretePath}, registered: ${pathEntry.branch ?? 'detached'}, requested: ${input.branch})`,
    );
  }

  if (!existsSync(concretePath)) {
    if (input.requireExisting)
      throw new Error(`registered worktree path does not exist: ${concretePath}`);
    return pathEntry;
  }

  if (lstatSync(concretePath).isSymbolicLink()) {
    throw new Error(`registered worktree path must not be a symlink: ${concretePath}`);
  }
  try {
    assertGitWorkspaceIdentity(input.projectPath, concretePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!input.allowBrokenIdentity || !/not a valid Git workspace/.test(message)) throw error;
  }
  return pathEntry;
}
