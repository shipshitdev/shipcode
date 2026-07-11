import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PipelineCheckpoint } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureExecutionCheckpoint,
  type ExecutionCheckpointDeps,
  type ExecutionCheckpointMeta,
} from './execution-checkpoint';

const { mockCapture, mockResolveHead, mockResolveBranch } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockResolveHead: vi.fn(),
  mockResolveBranch: vi.fn(),
}));

// The helper depends only on these three async git primitives — replace the
// whole module so no real git runs and the failure paths are deterministic.
vi.mock('@shipcode/git', () => ({
  captureCheckpoint: mockCapture,
  resolveHeadCommit: mockResolveHead,
  resolveCurrentBranch: mockResolveBranch,
}));

type Created = Parameters<ExecutionCheckpointDeps['checkpoints']['create']>[0];

function makeDeps(latest: PipelineCheckpoint | null = null) {
  const created: Created[] = [];
  const getLatest = vi.fn(() => latest);
  const create = vi.fn((row: Created) => {
    created.push(row);
    return { id: 'ck', createdAt: '', ...row } as unknown as PipelineCheckpoint;
  });
  return { created, deps: { checkpoints: { getLatest, create } }, getLatest, create };
}

const CWD = '/tmp/worktree';

function meta(overrides: Partial<ExecutionCheckpointMeta> = {}): ExecutionCheckpointMeta {
  return {
    projectId: 'proj-1',
    phase: 'executing',
    reason: 'after_execute',
    label: (turn) => `label turn=${turn}`,
    ...overrides,
  };
}

describe('captureExecutionCheckpoint', () => {
  beforeEach(() => {
    mockCapture.mockReset();
    mockResolveHead.mockReset();
    mockResolveBranch.mockReset();
  });

  it('reuses the captured HEAD sha/branch on success and spawns no extra resolver call', async () => {
    mockCapture.mockResolvedValue({
      refName: 'refs/shipcode/checkpoints/t/turn/2',
      turn: 2,
      commitSha: 'checkpoint-commit',
      headSha: 'head-sha',
      branch: 'feat/x',
    });
    const { deps, create } = makeDeps();

    await captureExecutionCheckpoint(CWD, 'thread-1', meta(), deps);

    expect(mockCapture).toHaveBeenCalledTimes(1); // single staging per invocation (#3 guard)
    // Hot path reuses captured metadata — no redundant rev-parse subprocess.
    expect(mockResolveHead).not.toHaveBeenCalled();
    expect(mockResolveBranch).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      threadId: 'thread-1',
      projectId: 'proj-1',
      phase: 'executing',
      reason: 'after_execute',
      label: 'label turn=2', // label built from the captured turn
      branch: 'feat/x',
      commitSha: 'head-sha', // worktree HEAD, NOT the checkpoint commit
      refName: 'refs/shipcode/checkpoints/t/turn/2',
    });
  });

  // The two call sites (pre-execute dedupe=true, post-attempt dedupe=false) must
  // behave IDENTICALLY on failure — previously they diverged (null-ref row vs no
  // row). Parametrize the policy assertions over both.
  for (const dedupe of [false, true]) {
    describe(`failure policy (dedupe=${dedupe})`, () => {
      it('writes a metadata-only row (refName=null) when ref capture throws', async () => {
        mockCapture.mockRejectedValue(new Error('git exploded'));
        mockResolveHead.mockResolvedValue('fallback-head');
        mockResolveBranch.mockResolvedValue('main');
        const { deps, create } = makeDeps();

        await expect(
          captureExecutionCheckpoint(CWD, 'thread-1', meta({ dedupe }), deps),
        ).resolves.toBeUndefined(); // never throws → never blocks the phase

        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0]).toMatchObject({
          commitSha: 'fallback-head',
          branch: 'main',
          refName: null, // dense turn sequence preserved despite capture failure
          label: 'label turn=null',
        });
      });

      it('skips the row (never throws) when the worktree HEAD is unresolvable', async () => {
        mockCapture.mockRejectedValue(new Error('git exploded'));
        mockResolveHead.mockResolvedValue(null); // unborn / broken HEAD
        mockResolveBranch.mockResolvedValue(null);
        const { deps, create } = makeDeps();

        await expect(
          captureExecutionCheckpoint(CWD, 'thread-1', meta({ dedupe }), deps),
        ).resolves.toBeUndefined();

        expect(create).not.toHaveBeenCalled(); // commit_sha is NOT NULL → no row
      });
    });
  }

  it('dedupe skips an identical consecutive row without minting a ref', async () => {
    mockResolveHead.mockResolvedValue('same-head');
    const { deps, create } = makeDeps({
      commitSha: 'same-head',
      phase: 'executing',
      reason: 'before_execute',
    } as PipelineCheckpoint);

    await captureExecutionCheckpoint(
      CWD,
      'thread-1',
      meta({ reason: 'before_execute', dedupe: true }),
      deps,
    );

    expect(mockCapture).not.toHaveBeenCalled(); // no orphan ref on a skipped row
    expect(create).not.toHaveBeenCalled();
  });

  it('dedupe still captures when the latest row differs', async () => {
    mockResolveHead.mockResolvedValue('new-head');
    mockCapture.mockResolvedValue({
      refName: 'refs/shipcode/checkpoints/t/turn/0',
      turn: 0,
      commitSha: 'ck',
      headSha: 'new-head',
      branch: 'main',
    });
    const { deps, create } = makeDeps({
      commitSha: 'old-head', // different commit → not a duplicate
      phase: 'executing',
      reason: 'before_execute',
    } as PipelineCheckpoint);

    await captureExecutionCheckpoint(
      CWD,
      'thread-1',
      meta({ reason: 'before_execute', dedupe: true }),
      deps,
    );

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('performs no synchronous git on the capture path', () => {
    // Guards finding #2: sync git subprocesses freeze the Electron main event
    // loop on the per-attempt hot path. The helper must use only async git.
    const source = readFileSync(
      fileURLToPath(new URL('./execution-checkpoint.ts', import.meta.url)),
      'utf-8',
    );
    expect(source).not.toContain('execFileSync');
    expect(source).not.toContain('execSync');
    expect(source).not.toContain('child_process');
  });
});
