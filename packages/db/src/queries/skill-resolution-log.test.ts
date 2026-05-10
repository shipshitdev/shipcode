import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { ProjectQueries } from './projects';
import { SkillResolutionLogQueries } from './skill-resolution-log';
import { ThreadQueries } from './threads';

describe('skill resolution log queries', () => {
  let db: DatabaseSync;
  let threadId: string;
  let logs: SkillResolutionLogQueries;

  beforeEach(() => {
    db = createTestDb();
    const projectId = new ProjectQueries(db).add('/tmp/skill-resolution-log').id;
    threadId = new ThreadQueries(db).create(projectId, 'prompt', 'Issue').id;
    logs = new SkillResolutionLogQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('maps optional fields, missing rows, and failed reloads', () => {
    const row = logs.create({
      threadId,
      providerPhase: 'execute',
      skillKey: 'plan-execution',
      source: 'fallback',
      fallbackUsed: true,
      errorCode: 'missing',
      errorMessage: 'Skill missing',
    });

    expect(row).toMatchObject({
      threadId,
      providerPhase: 'execute',
      skillKey: 'plan-execution',
      source: 'fallback',
      baseVersion: null,
      fallbackUsed: true,
      errorCode: 'missing',
      errorMessage: 'Skill missing',
    });
    expect(logs.getById('missing')).toBeNull();
    expect(logs.listByThread(threadId).map((entry) => entry.id)).toEqual([row.id]);

    const broken = new SkillResolutionLogQueries(db);
    broken.getById = () => null;
    expect(() =>
      broken.create({
        threadId,
        providerPhase: 'plan',
        skillKey: 'planning',
        source: 'bundled',
      }),
    ).toThrow(/Failed to load skill resolution row/);
  });
});
