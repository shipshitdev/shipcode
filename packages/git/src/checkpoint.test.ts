import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureCheckpoint,
  checkpointRefName,
  deleteAllCheckpointRefs,
  deleteThreadCheckpointRefs,
  listCheckpointRefs,
  parseCheckpointTurn,
  restoreCheckpoint,
} from './checkpoint';

// Integration tests against real throwaway git repos: checkpoint semantics
// (index isolation, deletion propagation, untracked capture) cannot be
// asserted meaningfully with a mocked git.
describe('checkpoint refs', () => {
  const tempDirs: string[] = [];

  function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
  }

  function makeRepo(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shipcode-checkpoint-'));
    tempDirs.push(dir);
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@shipcode.dev']);
    git(dir, ['config', 'user.name', 'ShipCode Test']);
    writeFileSync(path.join(dir, 'keep.txt'), 'original\n');
    writeFileSync(path.join(dir, 'doomed.txt'), 'doomed\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'base']);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('formats and parses ref names', () => {
    expect(checkpointRefName('thread-1', 3)).toBe('refs/shipcode/checkpoints/thread-1/turn/3');
    expect(checkpointRefName('weird!id', 0)).toBe('refs/shipcode/checkpoints/weird-id/turn/0');
    expect(parseCheckpointTurn('refs/shipcode/checkpoints/t/turn/12')).toBe(12);
    expect(parseCheckpointTurn('refs/heads/master')).toBeNull();
  });

  it('captures dirty state without mutating the index or creating visible refs', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'keep.txt'), 'modified\n');
    rmSync(path.join(repo, 'doomed.txt'));
    writeFileSync(path.join(repo, 'fresh.txt'), 'untracked\n');
    const statusBefore = git(repo, ['status', '--porcelain']);

    const captured = await captureCheckpoint(repo, 'thread-1');

    expect(captured.turn).toBe(0);
    expect(captured.refName).toBe('refs/shipcode/checkpoints/thread-1/turn/0');
    // Real index and status untouched by the temp-index capture.
    expect(git(repo, ['status', '--porcelain'])).toBe(statusBefore);
    // No visible branch/tag/stash created.
    expect(git(repo, ['branch', '--list']).split('\n')).toHaveLength(1);
    expect(git(repo, ['tag', '--list'])).toBe('');
    expect(git(repo, ['stash', 'list'])).toBe('');
    // Checkpoint tree holds the full dirty state.
    const tree = git(repo, ['ls-tree', '-r', '--name-only', captured.refName]);
    expect(tree).toContain('keep.txt');
    expect(tree).toContain('fresh.txt');
    expect(tree).not.toContain('doomed.txt');
    // Parent is the worktree HEAD at capture time.
    expect(git(repo, ['rev-parse', `${captured.refName}^`])).toBe(git(repo, ['rev-parse', 'HEAD']));
    // ShipCode identity on the checkpoint commit.
    expect(git(repo, ['show', '-s', '--format=%an <%ae>', captured.refName])).toBe(
      'ShipCode <shipcode@users.noreply.github.com>',
    );
  });

  it('numbers consecutive captures with increasing turns', async () => {
    const repo = makeRepo();
    const first = await captureCheckpoint(repo, 'thread-1');
    writeFileSync(path.join(repo, 'later.txt'), 'later\n');
    const second = await captureCheckpoint(repo, 'thread-1');

    expect(first.turn).toBe(0);
    expect(second.turn).toBe(1);
    const refs = await listCheckpointRefs(repo, 'thread-1');
    expect(refs.map((ref) => ref.turn)).toEqual([0, 1]);
  });

  it('derives the next turn from lastKnownTurn without scanning refs', async () => {
    const repo = makeRepo();
    // Only turn 0 exists on disk, but the DB high-water mark is 5. The hint
    // must win so a turn is never reused after prior refs were pruned (#328).
    await captureCheckpoint(repo, 'thread-1');
    const hinted = await captureCheckpoint(repo, 'thread-1', { lastKnownTurn: 5 });
    expect(hinted.turn).toBe(6);
    expect(hinted.refName).toBe('refs/shipcode/checkpoints/thread-1/turn/6');

    // A null hint falls back to the live-ref scan (legacy threads, no DB turn).
    const scanned = await captureCheckpoint(repo, 'thread-1', { lastKnownTurn: null });
    expect(scanned.turn).toBe(7);
  });

  it('never reuses a turn after a rollback prune, leaving surviving refs intact', async () => {
    const repo = makeRepo();
    // Turns 0..3, each capturing distinct content.
    for (let i = 0; i < 4; i++) {
      writeFileSync(path.join(repo, `f${i}.txt`), `content-${i}\n`);
      await captureCheckpoint(repo, 'thread-1', { lastKnownTurn: i - 1 });
    }
    const turn1Sha = git(repo, ['rev-parse', 'refs/shipcode/checkpoints/thread-1/turn/1']);

    // Restore to turn 1: refs 2 and 3 are stale and get pruned.
    await deleteThreadCheckpointRefs(repo, 'thread-1', { newerThanTurn: 1 });
    expect((await listCheckpointRefs(repo, 'thread-1')).map((ref) => ref.turn)).toEqual([0, 1]);

    // Next capture uses the DB high-water (turn 1) hint → turn 2, fresh content.
    writeFileSync(path.join(repo, 'reused.txt'), 'brand-new\n');
    const recaptured = await captureCheckpoint(repo, 'thread-1', { lastKnownTurn: 1 });
    expect(recaptured.turn).toBe(2);

    // Surviving turn/1 ref is untouched (no silent clobber of older content).
    expect(git(repo, ['rev-parse', 'refs/shipcode/checkpoints/thread-1/turn/1'])).toBe(turn1Sha);
    // The reused turn/2 ref points at the brand-new content, not stale content.
    const reusedTree = git(repo, [
      'ls-tree',
      '-r',
      '--name-only',
      'refs/shipcode/checkpoints/thread-1/turn/2',
    ]);
    expect(reusedTree).toContain('reused.txt');
    expect((await listCheckpointRefs(repo, 'thread-1')).map((ref) => ref.turn)).toEqual([0, 1, 2]);
  });

  it('prunes refs older than a turn for capture-time GC', async () => {
    const repo = makeRepo();
    for (let i = 0; i < 4; i++) {
      writeFileSync(path.join(repo, `g${i}.txt`), `g-${i}\n`);
      await captureCheckpoint(repo, 'thread-1', { lastKnownTurn: i - 1 });
    }
    await captureCheckpoint(repo, 'thread-2');

    // Keep the two most recent turns (2, 3): drop everything with turn < 2.
    const pruned = await deleteThreadCheckpointRefs(repo, 'thread-1', { olderThanTurn: 2 });
    expect(pruned).toBe(2);
    expect((await listCheckpointRefs(repo, 'thread-1')).map((ref) => ref.turn)).toEqual([2, 3]);
    // Other threads untouched.
    expect(await listCheckpointRefs(repo, 'thread-2')).toHaveLength(1);
  });

  it('restores the captured filesystem state and removes post-checkpoint files', async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'keep.txt'), 'modified\n');
    rmSync(path.join(repo, 'doomed.txt'));
    writeFileSync(path.join(repo, 'fresh.txt'), 'untracked\n');
    const baseSha = git(repo, ['rev-parse', 'HEAD']);
    const captured = await captureCheckpoint(repo, 'thread-1');

    // Post-checkpoint drift: commit everything, then add more work.
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'drift']);
    writeFileSync(path.join(repo, 'after.txt'), 'after\n');
    git(repo, ['add', 'after.txt']);
    git(repo, ['commit', '-q', '-m', 'more drift']);
    writeFileSync(path.join(repo, 'stray.txt'), 'stray\n');

    await restoreCheckpoint(repo, captured.refName);

    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(baseSha);
    expect(readFileSync(path.join(repo, 'keep.txt'), 'utf-8')).toBe('modified\n');
    expect(existsSync(path.join(repo, 'doomed.txt'))).toBe(false);
    expect(readFileSync(path.join(repo, 'fresh.txt'), 'utf-8')).toBe('untracked\n');
    expect(existsSync(path.join(repo, 'after.txt'))).toBe(false);
    expect(existsSync(path.join(repo, 'stray.txt'))).toBe(false);
    // Nothing staged: dirty state is reproduced as uncommitted changes.
    // Raw (untrimmed) porcelain output — the leading space is the staged column.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean)
      .sort();
    expect(status).toEqual([' D doomed.txt', ' M keep.txt', '?? fresh.txt']);
  });

  it('captures and restores from a linked worktree (shared common dir)', async () => {
    const repo = makeRepo();
    const worktree = path.join(repo, '.wt', 'linked');
    git(repo, ['worktree', 'add', '-q', '-b', 'wt-branch', worktree, 'HEAD']);
    writeFileSync(path.join(worktree, 'wt-file.txt'), 'wt\n');

    const captured = await captureCheckpoint(worktree, 'thread-wt');

    // Ref lives in the shared common dir: visible from the main repo too.
    expect(await listCheckpointRefs(repo, 'thread-wt')).toHaveLength(1);

    rmSync(path.join(worktree, 'wt-file.txt'));
    await restoreCheckpoint(worktree, captured.refName);
    expect(readFileSync(path.join(worktree, 'wt-file.txt'), 'utf-8')).toBe('wt\n');
  });

  it('deletes refs newer than a turn, then all refs for a thread', async () => {
    const repo = makeRepo();
    await captureCheckpoint(repo, 'thread-1');
    writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    await captureCheckpoint(repo, 'thread-1');
    writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    await captureCheckpoint(repo, 'thread-1');
    await captureCheckpoint(repo, 'thread-2');

    const pruned = await deleteThreadCheckpointRefs(repo, 'thread-1', { newerThanTurn: 0 });
    expect(pruned).toBe(2);
    expect((await listCheckpointRefs(repo, 'thread-1')).map((ref) => ref.turn)).toEqual([0]);
    // Other threads untouched.
    expect(await listCheckpointRefs(repo, 'thread-2')).toHaveLength(1);

    expect(await deleteThreadCheckpointRefs(repo, 'thread-1')).toBe(1);
    expect(await listCheckpointRefs(repo, 'thread-1')).toEqual([]);
  });

  it('deletes every checkpoint ref in the repo', async () => {
    const repo = makeRepo();
    await captureCheckpoint(repo, 'thread-1');
    await captureCheckpoint(repo, 'thread-2');

    expect(await deleteAllCheckpointRefs(repo)).toBe(2);
    expect(await listCheckpointRefs(repo, 'thread-1')).toEqual([]);
    expect(await listCheckpointRefs(repo, 'thread-2')).toEqual([]);
    expect(await deleteAllCheckpointRefs(repo)).toBe(0);
  });
});
