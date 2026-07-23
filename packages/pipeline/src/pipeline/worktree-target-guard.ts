import { WorktreeManager } from '@shipcode/git';
import type { PipelineDeps } from '../types';

export async function assertPersistedWorktreeTarget(
  deps: Pick<PipelineDeps, 'settings' | 'threads'>,
  input: { threadId: string; projectPath: string; worktreePath: string | null },
): Promise<void> {
  if (!input.worktreePath) {
    throw new Error(`Thread ${input.threadId} has no persisted worktree path`);
  }
  const thread = deps.threads.getById(input.threadId);
  if (
    !thread?.worktreePath ||
    !thread.worktreeBranch ||
    thread.worktreePath !== input.worktreePath
  ) {
    throw new Error(`Thread ${input.threadId} worktree does not match its persisted target`);
  }
  const settings = deps.settings.get();
  const manager = new WorktreeManager(input.projectPath, {
    worktreeRoot: settings.worktreeRoot,
    branchFormat: settings.worktreeBranchFormat,
  });
  await manager.assertRegistered(input.worktreePath, thread.worktreeBranch);
}
