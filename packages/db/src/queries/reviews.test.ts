import type { DatabaseSync } from 'node:sqlite';
import type { PlanReview } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { PlanQueries } from './plans';
import { ProjectQueries } from './projects';
import { ReviewQueries } from './reviews';
import { ThreadQueries } from './threads';

describe('ReviewQueries', () => {
  let db: DatabaseSync;
  let reviews: ReviewQueries;
  let planId: string;

  beforeEach(() => {
    db = createTestDb();
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const plans = new PlanQueries(db);
    const projectId = projects.add('/tmp/test').id;
    const threadId = threads.create(projectId, 'prompt', 'title').id;
    planId = plans.create(threadId, 'raw', null, 1).id;
    reviews = new ReviewQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('create() with structured uses its decision/confidence', () => {
    const structured: PlanReview = {
      planId,
      decision: 'approve',
      confidence: 'high',
      summary: 'looks good',
      findings: [],
      suggestedChanges: [],
    };
    const r = reviews.create(planId, 'raw review', structured);
    expect(r.decision).toBe('approve');
    expect(r.confidence).toBe('high');
    expect(r.structured).toEqual(structured);
  });

  it('create() with null structured defaults to request_changes/low', () => {
    const r = reviews.create(planId, 'raw review', null);
    expect(r.decision).toBe('request_changes');
    expect(r.confidence).toBe('low');
    expect(r.structured).toBeNull();
  });

  it('getByPlanId() returns latest review or null', () => {
    expect(reviews.getByPlanId(planId)).toBeNull();

    const first = reviews.create(planId, 'first', null);
    // Backdate first review so second is definitively newer
    db.prepare("UPDATE reviews SET created_at = datetime('now', '-1 hour') WHERE id = ?").run(
      first.id,
    );
    const second = reviews.create(planId, 'second', null);
    const found = reviews.getByPlanId(planId);
    expect(found).toBeTruthy();
    if (!found) throw new Error('Expected latest review');
    expect(found.id).toBe(second.id);
  });

  it('listByPlanIds() returns map of planId to review', () => {
    reviews.create(planId, 'review', null);
    const result = reviews.listByPlanIds([planId]);
    expect(result[planId]).toBeTruthy();
    expect(result[planId].planId).toBe(planId);
  });

  it('listByPlanIds() returns empty object for empty array', () => {
    expect(reviews.listByPlanIds([])).toEqual({});
  });
});
