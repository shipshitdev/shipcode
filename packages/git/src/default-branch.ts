import type { SimpleGit } from 'simple-git';

type DefaultBranchGit = Pick<SimpleGit, 'branchLocal' | 'raw'>;

/** Resolve the repository default without mistaking a worktree branch for trunk. */
export async function resolveDefaultBranch(git: DefaultBranchGit): Promise<string> {
  try {
    const result = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short']);
    return result.trim().replace('origin/', '');
  } catch {
    const branches = await git.branchLocal();
    if (branches.all.includes('main')) return 'main';
    if (branches.all.includes('master')) return 'master';
    return branches.current || 'main';
  }
}
