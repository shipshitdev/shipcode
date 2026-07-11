import {
  type CheckpointRef,
  captureCheckpoint,
  resolveCurrentBranch,
  resolveHeadCommit,
} from '@shipcode/git';
import type { PipelineCheckpoint, PipelineCheckpointPhase } from '@shipcode/shared';

/** Narrowed checkpoint-DB surface the capture helper needs. */
export interface ExecutionCheckpointDeps {
  checkpoints: {
    getLatest(threadId: string): PipelineCheckpoint | null;
    create(input: {
      threadId: string;
      projectId: string | null;
      phase: PipelineCheckpointPhase;
      reason: string;
      label: string;
      branch: string | null;
      commitSha: string;
      refName: string | null;
    }): PipelineCheckpoint;
  };
}

export interface ExecutionCheckpointMeta {
  projectId: string | null;
  phase: PipelineCheckpointPhase;
  reason: string;
  /**
   * Row label, built once the checkpoint turn is known. Receives the captured
   * turn, or `null` when ref capture failed (metadata-only fallback row).
   */
  label: (turn: number | null) => string;
  /**
   * Pre-execute only: skip writing when the latest row already pins this exact
   * (commitSha, phase, reason). Post-attempt passes `false` — every attempt is
   * a distinct checkpoint.
   */
  dedupe?: boolean;
}

/**
 * Single capture-and-persist path for execute-phase checkpoints (issue #212),
 * shared by the pre-execute and post-attempt call sites so both behave
 * identically.
 *
 * ONE FAILURE POLICY (documented, identical at both sites): checkpoint capture
 * is best-effort and MUST NEVER fail the execute phase.
 *   - Ref capture throws  → still write a metadata-only row (`refName: null`)
 *     so the checkpoint turn sequence stays dense regardless of which site ran
 *     (the pre-execute and post-attempt sites previously diverged here — one
 *     wrote a null-ref row, the other wrote nothing).
 *   - Worktree HEAD unresolvable → skip the row (the `commit_sha` column is NOT
 *     NULL) and log; the executor still runs.
 *
 * All git work is async (`execFile`), so the Electron main event loop is never
 * blocked — this runs after every execute attempt (× task-graph nodes ×
 * retries). On the hot success path the helper reuses the HEAD sha and branch
 * `captureCheckpoint` already computed, so it spawns no redundant `rev-parse`
 * subprocess; the async fallbacks fire only when ref capture failed.
 */
export async function captureExecutionCheckpoint(
  cwd: string,
  threadId: string,
  meta: ExecutionCheckpointMeta,
  deps: ExecutionCheckpointDeps,
): Promise<void> {
  // Pre-execute dedupe runs before capture so an identical consecutive entry
  // never mints an orphan ref. This path executes once per execute entry (cold),
  // so the extra async HEAD resolve is negligible.
  if (meta.dedupe) {
    const headForDedupe = await resolveHeadCommit(cwd);
    const latest = deps.checkpoints.getLatest(threadId);
    if (
      headForDedupe &&
      latest &&
      latest.commitSha === headForDedupe &&
      latest.phase === meta.phase &&
      latest.reason === meta.reason
    ) {
      return;
    }
  }

  let captured: CheckpointRef | null = null;
  try {
    captured = await captureCheckpoint(cwd, threadId);
  } catch (captureError) {
    console.error(`[pipeline] checkpoint ref capture failed for thread ${threadId}:`, captureError);
  }

  // Reuse the HEAD sha captureCheckpoint already resolved; only re-derive when
  // capture failed. The post-attempt hot path never hits the fallback.
  const commitSha = captured?.headSha ?? (await resolveHeadCommit(cwd));
  if (!commitSha) {
    console.error(
      `[pipeline] checkpoint row skipped for thread ${threadId}: could not resolve worktree HEAD`,
    );
    return;
  }

  const branch = captured?.branch ?? (await resolveCurrentBranch(cwd));

  deps.checkpoints.create({
    threadId,
    projectId: meta.projectId,
    phase: meta.phase,
    reason: meta.reason,
    label: meta.label(captured?.turn ?? null),
    branch,
    commitSha,
    refName: captured?.refName ?? null,
  });
}
