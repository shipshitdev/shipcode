import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../test-helpers';
import { FeatureQaResultQueries } from './feature-qa-results';

describe('FeatureQaResultQueries', () => {
  let db: DatabaseSync;
  let qaResults: FeatureQaResultQueries;

  beforeEach(() => {
    db = createTestDb();
    // FK satisfaction
    db.prepare(
      "INSERT INTO projects (id, name, path, git_remote, default_branch, created_at, updated_at) VALUES ('proj-1', 'test', '/tmp', 'git@x', 'main', datetime('now'), datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, project_id, prompt, title, status, created_at, updated_at) VALUES ('t1', 'proj-1', 'go', 'Test', 'idle', datetime('now'), datetime('now'))",
    ).run();
    qaResults = new FeatureQaResultQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts and retrieves a QA result', () => {
    const record = qaResults.insert({
      threadId: 't1',
      featureId: 'issue-42',
      status: 'passed',
      flowResults: [{ flowName: 'login', passed: true }],
      summary: 'All flows passed.',
    });

    expect(record.id).toBeTruthy();
    expect(record.threadId).toBe('t1');
    expect(record.featureId).toBe('issue-42');
    expect(record.status).toBe('passed');
    expect(record.flowResults).toEqual([{ flowName: 'login', passed: true }]);
    expect(record.summary).toBe('All flows passed.');
    expect(record.evidencePaths).toBeNull();
    expect(record.runAt).toBeTruthy();
  });

  it('returns null for missing ids and fails loudly when an inserted result cannot be reloaded', () => {
    expect(qaResults.getById('missing')).toBeNull();

    const getById = vi.spyOn(qaResults, 'getById').mockReturnValueOnce(null);
    expect(() =>
      qaResults.insert({
        threadId: 't1',
        featureId: 'issue-42',
        status: 'passed',
        flowResults: [],
        summary: 'done',
      }),
    ).toThrow('Failed to load feature QA result after insert');
    getById.mockRestore();
  });

  it('normalizes malformed JSON payloads to empty nullable values', () => {
    db.prepare(
      `INSERT INTO feature_qa_results
        (id, thread_id, feature_id, status, flow_results, summary, evidence_paths, run_at, created_at)
       VALUES (
         'qa-malformed',
         't1',
         'issue-bad',
         'partial',
         '{bad',
         'Malformed payload',
         '{bad',
         '',
         ''
       )`,
    ).run();

    expect(qaResults.getById('qa-malformed')).toMatchObject({
      flowResults: [],
      evidencePaths: null,
      runAt: '',
      createdAt: '',
    });
  });

  it('stores flow results with failure reasons', () => {
    const record = qaResults.insert({
      threadId: 't1',
      featureId: 'issue-10',
      status: 'failed',
      flowResults: [
        { flowName: 'login', passed: true },
        { flowName: 'dark-mode', passed: false, failureReason: 'Body missing .dark class' },
      ],
      summary: '1/2 flows failed.',
    });

    expect(record.flowResults).toHaveLength(2);
    expect(record.flowResults[1].passed).toBe(false);
    expect(record.flowResults[1].failureReason).toBe('Body missing .dark class');
  });

  it('stores evidence paths as JSON array', () => {
    const record = qaResults.insert({
      threadId: 't1',
      featureId: 'issue-5',
      status: 'failed',
      flowResults: [{ flowName: 'signup', passed: false, failureReason: 'timeout' }],
      summary: 'Signup timed out.',
      evidencePaths: ['/tmp/screenshot.png', '/tmp/trace.zip'],
    });

    expect(record.evidencePaths).toEqual(['/tmp/screenshot.png', '/tmp/trace.zip']);
  });

  it('stores visual assertion evidence on flow results', () => {
    const record = qaResults.insert({
      threadId: 't1',
      featureId: 'issue-6',
      status: 'failed',
      flowResults: [
        {
          flowName: 'Create button is pinned top left',
          passed: false,
          failureReason: 'Button rendered in bottom right.',
          evidencePaths: ['/tmp/qa/create-button.png'],
          assertions: [
            {
              name: 'Create button is pinned top left',
              passed: false,
              expected: 'target left/top within 24px of container left/top',
              actual: 'target x=900, y=700, w=80, h=32 container x=0, y=0, w=1200, h=80',
              evidencePath: '/tmp/qa/create-button.png',
            },
          ],
        },
      ],
      summary: 'Visual QA failed.',
      evidencePaths: ['/tmp/qa/create-button.png'],
    });

    expect(record.flowResults[0].assertions?.[0]).toEqual({
      name: 'Create button is pinned top left',
      passed: false,
      expected: 'target left/top within 24px of container left/top',
      actual: 'target x=900, y=700, w=80, h=32 container x=0, y=0, w=1200, h=80',
      evidencePath: '/tmp/qa/create-button.png',
    });
  });

  it('lists results by thread in reverse chronological order', () => {
    qaResults.insert({
      threadId: 't1',
      featureId: 'issue-1',
      status: 'passed',
      flowResults: [{ flowName: 'a', passed: true }],
      summary: 'first',
      runAt: '2025-01-01T00:00:00.000Z',
    });
    qaResults.insert({
      threadId: 't1',
      featureId: 'issue-2',
      status: 'failed',
      flowResults: [{ flowName: 'b', passed: false }],
      summary: 'second',
      runAt: '2025-01-02T00:00:00.000Z',
    });

    const results = qaResults.listByThread('t1');
    expect(results).toHaveLength(2);
    // Most recent first (reverse chronological)
    expect(results[0].featureId).toBe('issue-2');
    expect(results[1].featureId).toBe('issue-1');
  });

  it('lists results by feature id', () => {
    qaResults.insert({
      threadId: 't1',
      featureId: 'issue-42',
      status: 'passed',
      flowResults: [{ flowName: 'a', passed: true }],
      summary: 'run 1',
    });
    qaResults.insert({
      threadId: 't1',
      featureId: 'issue-42',
      status: 'failed',
      flowResults: [{ flowName: 'a', passed: false }],
      summary: 'run 2',
    });
    qaResults.insert({
      threadId: 't1',
      featureId: 'issue-99',
      status: 'passed',
      flowResults: [{ flowName: 'c', passed: true }],
      summary: 'other',
    });

    const results = qaResults.listByFeature('issue-42');
    expect(results).toHaveLength(2);
  });

  it('returns latest result for a feature', () => {
    qaResults.insert({
      threadId: 't1',
      featureId: 'issue-42',
      status: 'passed',
      flowResults: [{ flowName: 'a', passed: true }],
      summary: 'old run',
      runAt: '2025-01-01T00:00:00.000Z',
    });
    qaResults.insert({
      threadId: 't1',
      featureId: 'issue-42',
      status: 'failed',
      flowResults: [{ flowName: 'a', passed: false }],
      summary: 'latest run',
      runAt: '2025-01-02T00:00:00.000Z',
    });

    const latest = qaResults.latestByFeature('issue-42');
    expect(latest).not.toBeNull();
    expect(latest?.summary).toBe('latest run');
    expect(latest?.status).toBe('failed');
  });

  it('returns null for nonexistent feature', () => {
    expect(qaResults.latestByFeature('nonexistent')).toBeNull();
  });

  it('cascades on thread delete', () => {
    qaResults.insert({
      threadId: 't1',
      featureId: 'issue-1',
      status: 'passed',
      flowResults: [{ flowName: 'a', passed: true }],
      summary: 'test',
    });

    db.prepare("DELETE FROM threads WHERE id = 't1'").run();

    const results = qaResults.listByThread('t1');
    expect(results).toHaveLength(0);
  });
});
