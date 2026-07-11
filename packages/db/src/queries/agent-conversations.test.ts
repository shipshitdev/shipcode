import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../test-helpers';
import { AgentConversationQueries } from './agent-conversations';

describe('AgentConversationQueries', () => {
  let db: DatabaseSync;
  let conversations: AgentConversationQueries;

  beforeEach(() => {
    db = createTestDb();
    // Insert a project + thread for FK satisfaction
    db.prepare(
      "INSERT INTO projects (id, name, path, git_remote, default_branch, created_at, updated_at) VALUES ('proj-1', 'test', '/tmp', 'git@x', 'main', datetime('now'), datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, project_id, prompt, title, status, created_at, updated_at) VALUES ('t1', 'proj-1', 'go', 'Test', 'idle', datetime('now'), datetime('now'))",
    ).run();
    // Runs referenced by run_id FK on agent_conversations.
    for (const runId of ['run-a', 'run-b']) {
      db.prepare(
        "INSERT INTO pipeline_runs (id, thread_id, project_id, source, status, created_at, updated_at) VALUES (?, 't1', 'proj-1', 'github_issue', 'running', datetime('now'), datetime('now'))",
      ).run(runId);
    }
    conversations = new AgentConversationQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts and retrieves a conversation turn', () => {
    const record = conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'claude-planner',
      role: 'prompt',
      content: 'Plan this issue.',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    });

    expect(record.id).toBeTruthy();
    expect(record.threadId).toBe('t1');
    expect(record.phase).toBe('plan');
    expect(record.speaker).toBe('claude-planner');
    expect(record.role).toBe('prompt');
    expect(record.content).toBe('Plan this issue.');
    expect(record.provider).toBe('claude');
    expect(record.model).toBe('claude-sonnet-4-6');
  });

  it('returns null for missing ids and fails loudly when an inserted row cannot be reloaded', () => {
    expect(conversations.getById('missing')).toBeNull();

    const getById = vi.spyOn(conversations, 'getById').mockReturnValueOnce(null);
    expect(() =>
      conversations.insert({
        threadId: 't1',
        phase: 'plan',
        speaker: 'planner',
        role: 'prompt',
        content: 'p1',
      }),
    ).toThrow('Failed to load agent conversation after insert');
    getById.mockRestore();
  });

  it('falls back to the raw created_at value when it is not ISO-like', () => {
    db.prepare(
      `INSERT INTO agent_conversations
        (id, thread_id, phase, round, speaker, role, content, created_at)
       VALUES ('conv-raw-date', 't1', 'plan', 0, 'planner', 'prompt', 'p1', '')`,
    ).run();

    expect(conversations.getById('conv-raw-date')?.createdAt).toBe('');
  });

  it('lists turns by thread in time order', () => {
    conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'planner',
      role: 'prompt',
      content: 'p1',
    });
    conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'planner',
      role: 'response',
      content: 'r1',
    });
    conversations.insert({
      threadId: 't1',
      phase: 'review',
      speaker: 'reviewer',
      role: 'prompt',
      content: 'p2',
    });

    const all = conversations.listByThread('t1');
    expect(all).toHaveLength(3);
    expect(all[0].role).toBe('prompt');
    expect(all[1].role).toBe('response');
    expect(all[2].phase).toBe('review');
  });

  it('filters by phase', () => {
    conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'planner',
      role: 'prompt',
      content: 'p1',
    });
    conversations.insert({
      threadId: 't1',
      phase: 'review',
      speaker: 'reviewer',
      role: 'prompt',
      content: 'p2',
    });

    const filtered = conversations.listByThread('t1', { phase: 'review' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].phase).toBe('review');
  });

  it('filters by role', () => {
    conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'planner',
      role: 'prompt',
      content: 'p1',
    });
    conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'planner',
      role: 'response',
      content: 'r1',
    });

    const filtered = conversations.listByThread('t1', { role: 'response' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].role).toBe('response');
  });

  it('filters by runId, scoping turns to a single run', () => {
    conversations.insert({
      threadId: 't1',
      runId: 'run-a',
      phase: 'steering',
      speaker: 'human',
      role: 'prompt',
      content: 'skip the auth refactor',
    });
    conversations.insert({
      threadId: 't1',
      runId: 'run-b',
      phase: 'steering',
      speaker: 'human',
      role: 'prompt',
      content: 'use the shared helper',
    });

    const runA = conversations.listByThread('t1', { runId: 'run-a' });
    expect(runA).toHaveLength(1);
    expect(runA[0].content).toBe('skip the auth refactor');

    const runB = conversations.listByThread('t1', { runId: 'run-b' });
    expect(runB).toHaveLength(1);
    expect(runB[0].content).toBe('use the shared helper');
  });

  it('excludes legacy NULL run_id rows when a runId filter is provided', () => {
    // Legacy row written before run tracking populated run_id.
    db.prepare(
      `INSERT INTO agent_conversations
        (id, thread_id, run_id, phase, round, speaker, role, content, created_at)
       VALUES ('legacy-1', 't1', NULL, 'steering', 0, 'human', 'prompt', 'legacy steer', datetime('now'))`,
    ).run();
    conversations.insert({
      threadId: 't1',
      runId: 'run-a',
      phase: 'steering',
      speaker: 'human',
      role: 'prompt',
      content: 'scoped steer',
    });

    // Scoped query drops the NULL row (prevents cross-run bleed of legacy rows).
    const scoped = conversations.listByThread('t1', { runId: 'run-a' });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].content).toBe('scoped steer');

    // Unscoped query is unchanged and still returns everything.
    const all = conversations.listByThread('t1');
    expect(all).toHaveLength(2);
  });

  it('combines runId with phase and role filters', () => {
    conversations.insert({
      threadId: 't1',
      runId: 'run-a',
      phase: 'steering',
      speaker: 'human',
      role: 'prompt',
      content: 'steer a',
    });
    conversations.insert({
      threadId: 't1',
      runId: 'run-a',
      phase: 'plan',
      speaker: 'planner',
      role: 'prompt',
      content: 'plan a',
    });
    conversations.insert({
      threadId: 't1',
      runId: 'run-b',
      phase: 'steering',
      speaker: 'human',
      role: 'prompt',
      content: 'steer b',
    });

    const filtered = conversations.listByThread('t1', {
      runId: 'run-a',
      phase: 'steering',
      role: 'prompt',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].content).toBe('steer a');
  });

  it('counts turns by thread', () => {
    conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'planner',
      role: 'prompt',
      content: 'p1',
    });
    conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'planner',
      role: 'response',
      content: 'r1',
    });

    expect(conversations.countByThread('t1')).toBe(2);
    expect(conversations.countByThread('nonexistent')).toBe(0);
  });

  it('supports parent_id for threaded dialogue', () => {
    const parent = conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'planner-a',
      role: 'response',
      content: 'plan A',
    });
    const critique = conversations.insert({
      threadId: 't1',
      phase: 'plan',
      speaker: 'critic',
      role: 'response',
      content: 'critique of A',
      parentId: parent.id,
    });

    expect(critique.parentId).toBe(parent.id);
  });

  it('stores token and cost metadata', () => {
    const record = conversations.insert({
      threadId: 't1',
      phase: 'execute',
      speaker: 'codex',
      role: 'response',
      content: 'done',
      tokensIn: 1500,
      tokensOut: 3200,
      costUsd: 0.042,
    });

    expect(record.tokensIn).toBe(1500);
    expect(record.tokensOut).toBe(3200);
    expect(record.costUsd).toBeCloseTo(0.042);
  });
});
