import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { IssueChatSessionQueries } from './issue-chat-sessions';

describe('IssueChatSessionQueries', () => {
  let db: DatabaseSync;
  let sessions: IssueChatSessionQueries;

  beforeEach(() => {
    db = createTestDb();
    db.prepare(
      "INSERT INTO projects (id, name, path, git_remote, default_branch, created_at, updated_at) VALUES ('proj-1', 'test', '/tmp', 'git@x', 'main', datetime('now'), datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, project_id, prompt, title, status, created_at, updated_at) VALUES ('t1', 'proj-1', 'go', 'Test', 'idle', datetime('now'), datetime('now'))",
    ).run();
    sessions = new IssueChatSessionQueries(db);
  });

  it('upserts and retrieves provider session metadata by thread', () => {
    const created = sessions.upsert({
      threadId: 't1',
      provider: 'claude',
      sessionId: 'claude-session-1',
      cwd: '/tmp/worktree',
      model: 'claude-sonnet-4-6',
      reasoningEffort: 'high',
    });

    expect(created).toMatchObject({
      threadId: 't1',
      provider: 'claude',
      sessionId: 'claude-session-1',
      cwd: '/tmp/worktree',
      model: 'claude-sonnet-4-6',
      reasoningEffort: 'high',
    });

    const updated = sessions.upsert({
      threadId: 't1',
      provider: 'codex',
      sessionId: 'codex-thread-1',
      cwd: '/tmp/worktree-2',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });

    expect(updated).toMatchObject({
      threadId: 't1',
      provider: 'codex',
      sessionId: 'codex-thread-1',
      cwd: '/tmp/worktree-2',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });
  });

  it('updates the resumable provider session id after the first successful turn', () => {
    sessions.upsert({
      threadId: 't1',
      provider: 'claude',
      cwd: '/tmp/worktree',
    });

    expect(sessions.updateSessionId('t1', 'claude-session-2').sessionId).toBe('claude-session-2');
  });

  it('deletes sessions when the owning thread is deleted', () => {
    sessions.upsert({
      threadId: 't1',
      provider: 'claude',
      sessionId: 'claude-session-1',
      cwd: '/tmp/worktree',
    });

    db.prepare("DELETE FROM threads WHERE id = 't1'").run();

    expect(sessions.getByThread('t1')).toBeNull();
  });
});
