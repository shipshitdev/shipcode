import type { GhStatusMapping, IssuePipelineStatus } from '@shipcode/shared';

// ---------------------------------------------------------------------------
// GH Status write serializer — collapses rapid phase transitions into the
// latest desired state per issue, preventing out-of-order mutations.
// ---------------------------------------------------------------------------

export interface GhSyncWriteOpts {
  projectPath: string;
  projectUrl: string | null;
  issueNumber: number;
  pipelineStatus: IssuePipelineStatus;
  statusMapping: GhStatusMapping | null;
}

interface GhSyncQueueEntry {
  /** The promise of the currently in-flight GH write (null = idle). */
  inflight: Promise<void> | null;
  /** If a newer state arrived while a write was in-flight, it's stored here. */
  pending: GhSyncWriteOpts | null;
}

/**
 * Per-issue write queue that serializes GH Status mutations.
 *
 * - If no write is in-flight for a given issue, fires immediately.
 * - If a write is in-flight, stores the latest state in `pending` and
 *   replaces any previously pending state (collapse).
 * - When the in-flight write completes, it drains the pending entry.
 *
 * This prevents out-of-order GitHub mutations when rapid phase transitions
 * (e.g. queued → planning → reviewing) overlap on the network.
 */
export class GhSyncQueue {
  private readonly queue = new Map<string, GhSyncQueueEntry>();

  constructor(
    private readonly writeFn: (opts: GhSyncWriteOpts) => Promise<void>,
    private readonly onError?: (err: unknown) => void,
  ) {}

  enqueue(opts: GhSyncWriteOpts): void {
    const key = `${opts.projectPath}:${opts.issueNumber}`;
    let entry = this.queue.get(key);

    if (!entry) {
      entry = { inflight: null, pending: null };
      this.queue.set(key, entry);
    }

    if (entry.inflight) {
      // A write is already in-flight — collapse to latest desired state.
      entry.pending = opts;
      return;
    }

    // Start the write chain.
    const run = async (current: GhSyncWriteOpts): Promise<void> => {
      try {
        await this.writeFn(current);
      } catch (err) {
        (this.onError ?? console.warn.bind(console, '[gh-status-sync] queued write failed'))(err);
      }
      // Drain pending if another state was enqueued while we were writing.
      const e = this.queue.get(key);
      if (e?.pending) {
        const next = e.pending;
        e.pending = null;
        e.inflight = run(next);
      } else if (e) {
        e.inflight = null;
        this.queue.delete(key);
      }
    };

    entry.inflight = run(opts);
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
