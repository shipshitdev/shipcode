import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the bundled skill files with a single malicious traversal entry so the
// path-boundary guard inside seedRepoSkillBundle is actually exercised end-to-end.
// If the isPathInside guard is ever removed, this test fails — that is its whole
// purpose. vi.mock is hoisted and scoped to this file, so the real bundle used by
// repo-skill-seeder.test.ts is unaffected.
vi.mock('./bundled-repo-skills/dev-loop.generated', () => ({
  DEV_LOOP_REPO_SKILL_FILES: [{ path: '../escaped.md', content: 'pwned' }],
}));

import { seedRepoSkillBundle } from './repo-skill-seeder';

describe('repo skill seeder path guard', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-repo-skills-guard-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('throws and writes nothing when a bundle entry escapes skills/', () => {
    expect(() => seedRepoSkillBundle({ cwd: tempDir, force: true })).toThrow(
      /Refusing to write repo skill outside skills\//,
    );

    // The escaping entry resolves to <tempDir>/escaped.md (one level above skills/).
    // The guard must have prevented the write entirely.
    expect(fs.existsSync(path.join(tempDir, 'escaped.md'))).toBe(false);
  });
});
