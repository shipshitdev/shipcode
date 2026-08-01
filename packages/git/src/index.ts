export type { CheckpointRef } from './checkpoint';
export {
  CHECKPOINT_REF_ROOT,
  captureCheckpoint,
  checkpointRefName,
  checkpointRefPrefix,
  deleteAllCheckpointRefs,
  deleteThreadCheckpointRefs,
  listCheckpointRefs,
  parseCheckpointTurn,
  resolveCurrentBranch,
  resolveHeadCommit,
  restoreCheckpoint,
} from './checkpoint';
export type {
  BranchSnapshot,
  CleanupAnalysisInput,
  PullRequestSnapshot,
} from './cleanup-analyzer';
export { analyzeCleanup } from './cleanup-analyzer';
export type { GitRunner } from './git-exec';
export { buildScopedGitEnv, runGit, runGitUnlocked, withGitLock } from './git-exec';
export { GitService } from './git-service';
export { WorktreeManager } from './worktree';
export type { WorktreeArtifact, WorktreeArtifactCleanupResult } from './worktree-artifacts';
export {
  DEFAULT_WORKTREE_ARTIFACT_PATHS,
  listWorktreeArtifacts,
  pruneWorktreeArtifacts,
} from './worktree-artifacts';
export type { RegisteredWorktree } from './worktree-safety';
export {
  assertCanonicalWorktreePath,
  assertRegisteredWorktree,
  assertSafeWorktreeBranch,
  assertWorktreeCreateTarget,
  listRegisteredWorktrees,
  parseRegisteredWorktrees,
} from './worktree-safety';
