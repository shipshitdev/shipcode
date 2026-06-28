import { describe, expect, it, vi } from 'vitest';
import { type FanOutCandidate, runFanOut } from './fan-out-executor';

function candidate(label: string, over: Partial<FanOutCandidate> = {}): FanOutCandidate {
  return { label, rawOutput: `${label} output`, exitCode: 0, outputTokens: 100, ...over };
}

describe('runFanOut', () => {
  it('runs N workers, judges, promotes the judge-selected winner', async () => {
    const runWorker = vi.fn(async (i: number) => candidate(`worker-${i}`));
    const runJudge = vi.fn(async () => ({
      rawOutput: 'judged',
      exitCode: 0,
      winnerLabel: 'worker-1',
      outputTokens: 50,
    }));
    const promoteWinner = vi.fn(async () => {});

    const result = await runFanOut({ workerCount: 3, runWorker, runJudge, promoteWinner });

    expect(runWorker).toHaveBeenCalledTimes(3);
    expect(runJudge).toHaveBeenCalledTimes(1);
    expect(promoteWinner).toHaveBeenCalledWith(expect.objectContaining({ label: 'worker-1' }));
    expect(result).toMatchObject({
      exitCode: 0,
      rawOutput: 'judged',
      winnerLabel: 'worker-1',
      workersRun: 3,
      workersSucceeded: 3,
      judged: true,
      totalOutputTokens: 350, // 3×100 + 50
    });
  });

  it('skips the judge when exactly one worker passes and promotes it', async () => {
    const runWorker = vi.fn(async (i: number) =>
      i === 0 ? candidate('worker-0') : candidate(`worker-${i}`, { exitCode: 1 }),
    );
    const runJudge = vi.fn();
    const promoteWinner = vi.fn(async () => {});

    const result = await runFanOut({ workerCount: 3, runWorker, runJudge, promoteWinner });

    expect(runJudge).not.toHaveBeenCalled();
    expect(promoteWinner).toHaveBeenCalledWith(expect.objectContaining({ label: 'worker-0' }));
    expect(result).toMatchObject({ exitCode: 0, winnerLabel: 'worker-0', judged: false });
  });

  it('returns failure and promotes nothing when every worker fails', async () => {
    const runWorker = vi.fn(async (i: number) => candidate(`worker-${i}`, { exitCode: 1 }));
    const runJudge = vi.fn();
    const promoteWinner = vi.fn();

    const result = await runFanOut({ workerCount: 2, runWorker, runJudge, promoteWinner });

    expect(runJudge).not.toHaveBeenCalled();
    expect(promoteWinner).not.toHaveBeenCalled();
    expect(result.exitCode).not.toBe(0);
    expect(result.winnerLabel).toBeNull();
    expect(result.workersSucceeded).toBe(0);
  });

  it('treats a thrown worker as a non-candidate without failing the run', async () => {
    const runWorker = vi.fn(async (i: number) => {
      if (i === 0) throw new Error('worker crashed');
      return candidate(`worker-${i}`);
    });
    const runJudge = vi.fn(async () => ({ rawOutput: 'j', exitCode: 0, winnerLabel: 'worker-2' }));
    const promoteWinner = vi.fn(async () => {});

    const result = await runFanOut({ workerCount: 3, runWorker, runJudge, promoteWinner });

    expect(result.exitCode).toBe(0);
    expect(result.workersSucceeded).toBe(2);
  });

  it('falls back to the first passing candidate when the judge names an unknown label', async () => {
    const runWorker = vi.fn(async (i: number) => candidate(`worker-${i}`));
    const runJudge = vi.fn(async () => ({ rawOutput: 'j', exitCode: 0, winnerLabel: 'nope' }));
    const promoteWinner = vi.fn(async () => {});

    const result = await runFanOut({ workerCount: 2, runWorker, runJudge, promoteWinner });

    expect(promoteWinner).toHaveBeenCalledWith(expect.objectContaining({ label: 'worker-0' }));
    expect(result.winnerLabel).toBe('worker-0');
  });

  it('keeps the winner output when the judge itself errors', async () => {
    const runWorker = vi.fn(async (i: number) => candidate(`worker-${i}`));
    const runJudge = vi.fn(async () => ({
      rawOutput: 'judge failed',
      exitCode: 1,
      winnerLabel: 'worker-0',
    }));
    const promoteWinner = vi.fn(async () => {});

    const result = await runFanOut({ workerCount: 2, runWorker, runJudge, promoteWinner });

    expect(result.exitCode).toBe(0);
    expect(result.rawOutput).toBe('worker-0 output');
  });

  it('clamps an excessive worker count to the max', async () => {
    const runWorker = vi.fn(async (i: number) => candidate(`worker-${i}`));
    const runJudge = vi.fn(async () => ({ rawOutput: 'j', exitCode: 0, winnerLabel: 'worker-0' }));
    const promoteWinner = vi.fn(async () => {});

    const result = await runFanOut({ workerCount: 99, runWorker, runJudge, promoteWinner });

    expect(runWorker).toHaveBeenCalledTimes(8); // MAX_FAN_OUT_WORKER_COUNT
    expect(result.workersRun).toBe(8);
  });

  it('respects the concurrency limit (never more than maxConcurrent in flight)', async () => {
    let inFlight = 0;
    let peak = 0;
    const runWorker = vi.fn(async (i: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return candidate(`worker-${i}`);
    });
    const runJudge = vi.fn(async () => ({ rawOutput: 'j', exitCode: 0, winnerLabel: 'worker-0' }));
    const promoteWinner = vi.fn(async () => {});

    await runFanOut({ workerCount: 6, maxConcurrent: 2, runWorker, runJudge, promoteWinner });

    expect(peak).toBeLessThanOrEqual(2);
    expect(runWorker).toHaveBeenCalledTimes(6);
  });
});
