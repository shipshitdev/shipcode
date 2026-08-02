import type { GhStatusMapping, IssuePipelineStatus } from '@shipcode/shared';

// ---------------------------------------------------------------------------
// GH Status write serializer — collapses rapid phase transitions into the
// latest desired state per issue, preventing out-of-order mutations, and
// retries transient GitHub failures with bounded backoff.
// ---------------------------------------------------------------------------

export interface GhSyncWriteOpts {
  projectPath: string;
  /**
   * `owner/name` of the GitHub repository this checkout points at, when known.
   * Two local clones of the same repository are two ShipCode projects with two
   * different `projectPath`s but one shared issue on GitHub — keying the queue
   * on the repo identity keeps their writes serialized instead of racing.
   * Falls back to `projectPath` when a project has no linked repo yet.
   */
  repoFullName?: string | null;
  projectUrl: string | null;
  issueNumber: number;
  pipelineStatus: IssuePipelineStatus;
  statusMapping: GhStatusMapping | null;
}

/** Context handed to `onError` when a write is abandoned after its last retry. */
export interface GhSyncWriteFailure {
  opts: GhSyncWriteOpts;
  /** How many times the write was attempted before giving up. */
  attempts: number;
  error: unknown;
}

export interface GhSyncQueueOptions {
  /** Total attempts per write, including the first. Default 3. */
  maxAttempts?: number;
  /** First retry delay; doubles per attempt. Default 500ms. */
  baseDelayMs?: number;
  /** Injectable sleep so tests don't pay real backoff. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called once per write that exhausted its retries. This is the queue's
   * persistent-failure channel: a dropped sync is permanent drift (the
   * reconciliation loop only reads GitHub → pipeline, never back), so it must
   * never be silent.
   */
  onError?: (failure: GhSyncWriteFailure) => void;
}

interface GhSyncQueueEntry {
  /** The promise of the currently in-flight GH write (null = idle). */
  inflight: Promise<void> | null;
  /** If a newer state arrived while a write was in-flight, it's stored here. */
  pending: GhSyncWriteOpts | null;
  /** Settlers for callers waiting on `pending` to be written. */
  pendingWaiters: Array<(outcome: PromiseSettledResult<void>) => void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Serialization key: repo identity when known, local checkout otherwise. */
export function ghSyncQueueKey(opts: GhSyncWriteOpts): string {
  const repo = opts.repoFullName?.trim();
  const scope = repo ? repo.toLowerCase() : opts.projectPath;
  return `${scope}:${opts.issueNumber}`;
}

/**
 * Per-issue write queue that serializes GH Status mutations.
 *
 * - If no write is in-flight for a given issue, fires immediately.
 * - If a write is in-flight, stores the latest state in `pending` and
 *   replaces any previously pending state (collapse).
 * - When the in-flight write completes, it drains the pending entry.
 * - A failed write is retried with bounded exponential backoff, unless a newer
 *   state is already pending — that write supersedes this one, so retrying a
 *   stale state would only write it back.
 *
 * This prevents out-of-order GitHub mutations when rapid phase transitions
 * (e.g. queued → planning → reviewing) overlap on the network.
 */
export class GhSyncQueue {
  private readonly queue = new Map<string, GhSyncQueueEntry>();
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onError?: (failure: GhSyncWriteFailure) => void;

  constructor(
    private readonly writeFn: (opts: GhSyncWriteOpts) => Promise<void>,
    options: GhSyncQueueOptions = {},
  ) {
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
    this.baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS));
    this.sleep = options.sleep ?? defaultSleep;
    this.onError = options.onError;
  }

  /**
   * Enqueue a state snapshot. The returned promise reflects the outcome of the
   * write that carries this state to GitHub: it resolves once that write
   * succeeds and rejects once it has exhausted its retries. A snapshot that is
   * collapsed away by a newer one settles with the newer write's outcome —
   * the newer state is what GitHub ends up holding.
   *
   * Callers may ignore the promise (the queue reports persistent failures
   * through `onError` regardless), but must not let a rejection go unhandled.
   */
  enqueue(opts: GhSyncWriteOpts): Promise<void> {
    const key = ghSyncQueueKey(opts);
    let entry = this.queue.get(key);

    if (!entry) {
      entry = { inflight: null, pending: null, pendingWaiters: [] };
      this.queue.set(key, entry);
    }

    if (entry.inflight) {
      // A write is already in-flight — collapse to latest desired state.
      entry.pending = opts;
      return new Promise<void>((resolve, reject) => {
        entry.pendingWaiters.push((outcome) => {
          if (outcome.status === 'fulfilled') resolve();
          else reject(outcome.reason);
        });
      });
    }

    return new Promise<void>((resolve, reject) => {
      entry.inflight = this.run(key, opts, (outcome) => {
        if (outcome.status === 'fulfilled') resolve();
        else reject(outcome.reason);
      });
    });
  }

  /** Run one write (with retries), then drain whatever collapsed behind it. */
  private async run(
    key: string,
    opts: GhSyncWriteOpts,
    settle: (outcome: PromiseSettledResult<void>) => void,
  ): Promise<void> {
    const outcome = await this.attemptWrite(key, opts);
    settle(outcome);

    // Drain pending if another state was enqueued while we were writing.
    const entry = this.queue.get(key);
    if (entry?.pending) {
      const next = entry.pending;
      const waiters = entry.pendingWaiters;
      entry.pending = null;
      entry.pendingWaiters = [];
      entry.inflight = this.run(key, next, (nextOutcome) => {
        for (const waiter of waiters) waiter(nextOutcome);
      });
    } else if (entry) {
      entry.inflight = null;
      this.queue.delete(key);
    }
  }

  /** Attempt one state snapshot, retrying transient failures with backoff. */
  private async attemptWrite(
    key: string,
    opts: GhSyncWriteOpts,
  ): Promise<PromiseSettledResult<void>> {
    let lastError: unknown;
    let attempts = 0;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      attempts = attempt;
      try {
        await this.writeFn(opts);
        return { status: 'fulfilled', value: undefined };
      } catch (err) {
        lastError = err;
        // A newer state is already queued behind this one. Retrying would
        // spend backoff writing a state GitHub is about to be told to leave.
        if (this.queue.get(key)?.pending) break;
        if (attempt < this.maxAttempts) await this.sleep(this.baseDelayMs * 2 ** (attempt - 1));
      }
    }

    this.onError?.({ opts, attempts, error: lastError });
    return { status: 'rejected', reason: lastError };
  }

  /** Number of issues with in-flight or pending writes. For testing. */
  get size(): number {
    return this.queue.size;
  }

  /**
   * Wait for all in-flight + pending writes to drain. For testing.
   * Resolves when the queue is empty.
   */
  async drain(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const entry of this.queue.values()) {
      if (entry.inflight) promises.push(entry.inflight);
    }
    if (promises.length === 0) return;
    await Promise.allSettled(promises);
    // Recurse in case pending items started new in-flight writes.
    if (this.queue.size > 0) return this.drain();
  }
}
