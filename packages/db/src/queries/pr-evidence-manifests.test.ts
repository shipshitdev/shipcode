import type { DatabaseSync } from 'node:sqlite';
import type { PrEvidenceManifest } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { PrEvidenceManifestQueries } from './pr-evidence-manifests';

function manifest(overrides: Partial<PrEvidenceManifest> = {}): PrEvidenceManifest {
  return {
    schemaVersion: 1,
    revision: 1,
    threadId: 'thread-1',
    planId: 'plan-1',
    createdAt: '2026-07-20T00:00:00.000Z',
    issue: {
      repository: 'shipshitdev/shipcode',
      number: 416,
      title: 'Define the PR evidence manifest',
      acceptanceCriteria: [{ id: 'criterion-1', text: 'Persist a validated manifest.' }],
    },
    plan: {
      id: 'plan-1',
      version: 1,
      objective: 'Persist the evidence contract.',
      lockedAt: '2026-07-20T00:00:00.000Z',
      steps: [{ id: 'step-1', order: 1, description: 'Persist it.', files: ['file.ts'] }],
    },
    changes: {
      baseSha: 'cb79f468ac81ee41603060ee878b4340c648c163',
      headSha: 'cb79f468ac81ee41603060ee878b4340c648c163',
      commits: [],
      files: [],
      scopeDrift: [],
    },
    verification: {
      criteria: [{ subjectId: 'criterion-1', state: 'proven', evidenceIds: ['test-1'] }],
      planSteps: [{ subjectId: 'step-1', state: 'proven', evidenceIds: ['test-1'] }],
      checks: [],
    },
    permissions: {
      capabilities: [
        {
          capability: 'repository_write',
          status: 'granted',
          source: 'automation scope',
          evidenceIds: [],
        },
      ],
      approvals: [],
    },
    unresolvedRisks: [],
    evidence: [{ id: 'test-1', kind: 'test', label: 'Focused tests', locator: 'ci://123' }],
    ...overrides,
  };
}

describe('PrEvidenceManifestQueries', () => {
  let db: DatabaseSync;
  let queries: PrEvidenceManifestQueries;

  beforeEach(() => {
    db = createTestDb();
    db.exec(`
      INSERT INTO projects (id, name, path) VALUES ('project-1', 'ShipCode', '/tmp/shipcode');
      INSERT INTO threads (id, project_id, prompt, title, status)
      VALUES ('thread-1', 'project-1', 'prompt', 'Issue 416', 'idle');
      INSERT INTO threads (id, project_id, prompt, title, status)
      VALUES ('thread-2', 'project-1', 'prompt', 'Other issue', 'idle');
      INSERT INTO plans (id, thread_id, version, raw_output, structured, status)
      VALUES ('plan-1', 'thread-1', 1, '{}', NULL, 'approved');
    `);
    queries = new PrEvidenceManifestQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('persists, validates, redacts, and retrieves a manifest', () => {
    const input = manifest();
    input.evidence[0].summary = 'Bearer secret-token password=hunter2';

    const record = queries.save({ idempotencyKey: 'thread-1:plan-1:1', manifest: input });

    expect(record.threadId).toBe('thread-1');
    expect(record.planId).toBe('plan-1');
    expect(record.revision).toBe(1);
    expect(record.manifest.evidence[0].summary).toBe('Bearer [REDACTED] password=[REDACTED]');
    expect(queries.getLatestByThread('thread-1')?.id).toBe(record.id);
    expect(queries.getByPlanId('plan-1')).toHaveLength(1);
  });

  it('returns the original row for an identical idempotent write', () => {
    const input = manifest();
    const first = queries.save({ idempotencyKey: 'thread-1:plan-1:1', manifest: input });
    const second = queries.save({ idempotencyKey: 'thread-1:plan-1:1', manifest: input });

    expect(second.id).toBe(first.id);
  });

  it('returns the latest revision for a thread', () => {
    queries.save({ idempotencyKey: 'thread-1:plan-1:1', manifest: manifest() });
    const latest = queries.save({
      idempotencyKey: 'thread-1:plan-1:2',
      manifest: manifest({ revision: 2, createdAt: '2026-07-20T01:00:00.000Z' }),
    });

    expect(queries.getLatestByThread('thread-1')?.id).toBe(latest.id);
    expect(queries.getByPlanId('plan-1').map((record) => record.revision)).toEqual([2, 1]);
  });

  it('rejects idempotency-key reuse with different content', () => {
    queries.save({ idempotencyKey: 'thread-1:plan-1:1', manifest: manifest() });

    expect(() =>
      queries.save({
        idempotencyKey: 'thread-1:plan-1:1',
        manifest: manifest({ createdAt: '2026-07-20T01:00:00.000Z' }),
      }),
    ).toThrow('was reused with different content');
  });

  it('rejects a second idempotency key for the same plan revision', () => {
    queries.save({ idempotencyKey: 'thread-1:plan-1:1', manifest: manifest() });

    expect(() =>
      queries.save({ idempotencyKey: 'another-operation', manifest: manifest() }),
    ).toThrow('revision 1 already exists for plan plan-1');
  });

  it('rejects a manifest whose locked plan belongs to another thread', () => {
    expect(() =>
      queries.save({
        idempotencyKey: 'thread-2:plan-1:1',
        manifest: manifest({ threadId: 'thread-2' }),
      }),
    ).toThrow('does not belong to thread thread-2');
  });

  it('fails actionably when stored JSON is malformed', () => {
    db.prepare(
      `INSERT INTO pr_evidence_manifests (
         id, thread_id, plan_id, schema_version, revision, idempotency_key, manifest_json
       ) VALUES ('bad-row', 'thread-1', 'plan-1', 1, 2, 'bad-key', '{bad')`,
    ).run();

    expect(() => queries.getById('bad-row')).toThrow('Invalid PR evidence manifest row bad-row');
  });

  it('cascades manifests when their thread is deleted', () => {
    const record = queries.save({
      idempotencyKey: 'thread-1:plan-1:1',
      manifest: manifest(),
    });

    db.prepare("DELETE FROM threads WHERE id = 'thread-1'").run();

    expect(queries.getById(record.id)).toBeNull();
  });
});
