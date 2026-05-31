import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { PlanQueries } from './plans';
import { ProjectQueries } from './projects';
import { ReviewFindingQueries } from './review-findings';
import { ReviewQueries } from './reviews';
import { ThreadQueries } from './threads';

describe('ReviewFindingQueries', () => {
  let db: DatabaseSync;
  let findings: ReviewFindingQueries;
  let projectId: string;
  let threadId: string;
  let planId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = new ProjectQueries(db).add('/tmp/review-findings-project').id;
    threadId = new ThreadQueries(db).create(projectId, 'prompt', 'Issue').id;
    planId = new PlanQueries(db).create(threadId, 'raw', null, 1).id;
    findings = new ReviewFindingQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates and lists open findings by severity', () => {
    const first = findings.createOrUpdateOpen({
      projectId,
      threadId,
      planId,
      phase: 'verify',
      source: 'verification',
      severity: 'warning',
      title: 'Missing test',
      description: 'Add coverage',
      fingerprint: 'warn',
    });
    const second = findings.createOrUpdateOpen({
      projectId,
      threadId,
      planId,
      phase: 'review',
      source: 'review',
      severity: 'critical',
      title: 'Unsafe plan',
      description: 'Plan touches credentials',
      fingerprint: 'critical',
    });

    expect(findings.listOpenByThread(threadId).map((finding) => finding.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('replaces review findings by superseding previous open rows for the plan', () => {
    const original = findings.createOrUpdateOpen({
      projectId,
      threadId,
      planId,
      phase: 'review',
      source: 'review',
      severity: 'major',
      title: 'Old',
      description: 'Old finding',
      fingerprint: 'same',
    });
    const reviewId = new ReviewQueries(db).create(planId, 'raw', null).id;

    const [replacement] = findings.replaceOpenForReview({
      threadId,
      planId,
      reviewId,
      findings: [
        {
          projectId,
          threadId,
          planId,
          phase: 'review',
          source: 'review',
          severity: 'minor',
          title: 'New',
          description: 'New finding',
          fingerprint: 'same',
        },
      ],
    });

    expect(findings.getById(original.id)?.status).toBe('superseded');
    expect(replacement.status).toBe('open');
    expect(replacement.title).toBe('New');
  });

  it('marks open findings fixed for a plan', () => {
    const finding = findings.createOrUpdateOpen({
      projectId,
      threadId,
      planId,
      phase: 'verify',
      source: 'verification',
      severity: 'blocker',
      title: 'Build failed',
      description: 'Typecheck failed',
      fingerprint: 'build',
    });

    expect(findings.markOpenFixed({ threadId, planId, commitSha: 'abc123' })).toBe(1);

    const fixed = findings.getById(finding.id);
    expect(fixed?.status).toBe('fixed');
    expect(fixed?.resolvedByRunId).toBeNull();
    expect(fixed?.commitSha).toBe('abc123');
  });

  it('lets the user ignore a finding', () => {
    const finding = findings.createOrUpdateOpen({
      projectId,
      threadId,
      planId,
      phase: 'review',
      source: 'review',
      severity: 'nit',
      title: 'Naming',
      description: 'Rename local',
      fingerprint: 'naming',
    });

    expect(findings.updateStatus(finding.id, 'ignored')?.status).toBe('ignored');
    expect(findings.listOpenByThread(threadId)).toEqual([]);
    expect(findings.listByThread(threadId, { includeClosed: true })).toHaveLength(1);
  });
});
