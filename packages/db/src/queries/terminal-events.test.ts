import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { ProjectQueries } from './projects';
import { TerminalEventQueries } from './terminal-events';
import { ThreadQueries } from './threads';

describe('TerminalEventQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;
  let threads: ThreadQueries;
  let terminalEvents: TerminalEventQueries;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    projects = new ProjectQueries(db);
    threads = new ThreadQueries(db);
    terminalEvents = new TerminalEventQueries(db);
    const projectId = projects.add('/tmp/test-project').id;
    threadId = threads.create(projectId, 'prompt', 'Task').id;
  });

  afterEach(() => {
    db.close();
  });

  it('create() stores and returns canonical terminal events', () => {
    const record = terminalEvents.create(threadId, { kind: 'text', content: 'hello' });

    expect(record.id).toBeTruthy();
    expect(record.threadId).toBe(threadId);
    expect(record.event).toEqual({ kind: 'text', content: 'hello' });
    expect(record.createdAt).toBeTruthy();
  });

  it('falls back to the raw timestamp when created_at is not ISO parseable', () => {
    const record = terminalEvents.create(threadId, { kind: 'text', content: 'raw time' });
    db.prepare(`UPDATE terminal_events SET created_at = '' WHERE id = ?`).run(record.id);

    expect(terminalEvents.listByThread(threadId)[0].createdAt).toBe('');
  });

  it('listByThread() returns events in insertion order', () => {
    const first = terminalEvents.create(threadId, { kind: 'text', content: 'first' });
    const second = terminalEvents.create(threadId, { kind: 'text', content: 'second' });
    const rows = terminalEvents.listByThread(threadId);

    expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(rows.map((row) => row.event)).toEqual([
      { kind: 'text', content: 'first' },
      { kind: 'text', content: 'second' },
    ]);
  });

  it('listByThread() applies the limit to the newest rows, then returns them oldest-first', () => {
    terminalEvents.create(threadId, { kind: 'text', content: 'first' });
    terminalEvents.create(threadId, { kind: 'text', content: 'second' });
    terminalEvents.create(threadId, { kind: 'text', content: 'third' });

    expect(terminalEvents.listByThread(threadId, 2).map((row) => row.event)).toEqual([
      { kind: 'text', content: 'second' },
      { kind: 'text', content: 'third' },
    ]);
  });
});
