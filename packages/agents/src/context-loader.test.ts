import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRepoContext } from './context-loader';

const tempDirs: string[] = [];

function makeRepoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shipcode-context-loader-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadRepoContext', () => {
  it('loads memory files first and strips frontmatter', () => {
    const repoDir = makeRepoDir();
    const memoryDir = join(repoDir, '.agents/memory');
    mkdirSync(memoryDir, { recursive: true });

    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      `---
name: repo_memory
description: brief
type: project
status: active
last_verified: 2026-04-22
topics: [overview]
---

Brief memory.`,
    );
    writeFileSync(join(memoryDir, 'goal.md'), '# Goal\n\nShip quality software.');
    writeFileSync(join(memoryDir, 'notes.md'), '# Notes\n\nExtra detail.');

    const loaded = loadRepoContext(repoDir);

    expect(loaded).toContain('## MEMORY.md\nBrief memory.');
    expect(loaded).toContain('## goal.md\n# Goal\n\nShip quality software.');
    expect(loaded).toContain('## notes.md\n# Notes\n\nExtra detail.');
    expect(loaded).not.toContain('name: repo_memory');
  });

  it('returns a clear fallback string when no repo memory exists', () => {
    const repoDir = makeRepoDir();

    expect(loadRepoContext(repoDir)).toBe('No repo memory files found.');
  });
});
