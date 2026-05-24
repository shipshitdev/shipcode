import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRepoMemory } from './memory-loader';

const tempDirs: string[] = [];

function makeRepoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shipcode-memory-loader-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadRepoMemory', () => {
  it('loads markdown memory files in priority order and strips frontmatter', () => {
    const repoDir = makeRepoDir();
    const memoryDir = join(repoDir, '.agents/memory');
    mkdirSync(memoryDir, { recursive: true });

    writeFileSync(join(memoryDir, 'z-notes.md'), '# Later\n\nTrailing note.');
    writeFileSync(join(memoryDir, 'constraints.md'), '# Constraints\n\nKeep it scoped.');
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      `---
name: repo_memory
description: brief
---

Brief memory.`,
    );
    writeFileSync(join(memoryDir, 'empty.md'), '---\nname: empty\n---\n\n');

    const loaded = loadRepoMemory(repoDir);

    expect(loaded).toBe(
      [
        '## MEMORY.md\nBrief memory.',
        '## constraints.md\n# Constraints\n\nKeep it scoped.',
        '## z-notes.md\n# Later\n\nTrailing note.',
      ].join('\n\n'),
    );
    expect(loaded).not.toContain('name: repo_memory');
    expect(loaded).not.toContain('empty.md');
  });

  it('returns a fallback when memory is absent and skips unreadable files', () => {
    const repoDir = makeRepoDir();
    expect(loadRepoMemory(repoDir)).toBe('No repo memory files found.');

    const memoryDir = join(repoDir, '.agents/memory');
    mkdirSync(memoryDir, { recursive: true });
    const unreadable = join(memoryDir, 'goal.md');
    writeFileSync(unreadable, '# Goal\n\nHidden.');
    chmodSync(unreadable, 0o000);

    try {
      expect(loadRepoMemory(repoDir)).toBe('No repo memory files found.');
    } finally {
      chmodSync(unreadable, 0o600);
    }
  });
});
