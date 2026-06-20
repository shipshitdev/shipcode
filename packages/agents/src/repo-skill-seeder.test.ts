import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRepoSkillBundleFiles, seedRepoSkillBundle } from './repo-skill-seeder';

describe('repo skill seeder', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-repo-skills-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists the curated dev-loop bundle files', () => {
    const files = listRepoSkillBundleFiles('dev-loop');

    expect(files.some((file) => file.path === 'writing-prds/SKILL.md')).toBe(true);
    expect(
      files.some((file) => file.path === 'gh-project-board/scripts/setup-gh-project-board.mjs'),
    ).toBe(true);
    expect(files.every((file) => file.path.startsWith('skills/'))).toBe(false);
  });

  it('writes bundled skills into the target repo skills directory', () => {
    const result = seedRepoSkillBundle({ cwd: tempDir });

    expect(result.bundle).toBe('dev-loop');
    expect(result.targetDir).toBe(path.join(tempDir, 'skills'));
    expect(result.files.every((file) => file.status === 'written')).toBe(true);
    expect(
      fs.readFileSync(path.join(tempDir, 'skills', 'writing-prds', 'SKILL.md'), 'utf-8'),
    ).toContain('name: writing-prds');
  });

  it('skips existing files unless force is enabled', () => {
    const target = path.join(tempDir, 'skills', 'writing-prds', 'SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'custom repo skill', 'utf-8');

    const skipped = seedRepoSkillBundle({ cwd: tempDir });

    expect(skipped.files.find((file) => file.path === 'skills/writing-prds/SKILL.md')?.status).toBe(
      'skipped',
    );
    expect(fs.readFileSync(target, 'utf-8')).toBe('custom repo skill');

    const overwritten = seedRepoSkillBundle({ cwd: tempDir, force: true });

    expect(
      overwritten.files.find((file) => file.path === 'skills/writing-prds/SKILL.md')?.status,
    ).toBe('written');
    expect(fs.readFileSync(target, 'utf-8')).toContain('name: writing-prds');
  });

  it('every real bundle file path stays confined within skills/', () => {
    // Data sanity check: none of the shipped dev-loop bundle entries escape skills/.
    // The guard itself is exercised end-to-end in repo-skill-seeder.path-guard.test.ts.
    const files = listRepoSkillBundleFiles('dev-loop');
    const skillsRoot = path.resolve(tempDir, 'skills');

    for (const file of files) {
      const absolutePath = path.resolve(skillsRoot, file.path);
      const relative = path.relative(skillsRoot, absolutePath);
      expect(relative, `${file.path} escapes skills/`).not.toMatch(/^\.\./);
      expect(path.isAbsolute(relative), `${file.path} resolved absolute`).toBe(false);
    }
  });

  it('seeds the ShipCode label profile instead of generic dev-loop labels', () => {
    const joined = listRepoSkillBundleFiles('dev-loop')
      .map((file) => file.content)
      .join('\n');

    expect(joined).toContain('shipcode:agent:claude');
    expect(joined).toContain('shipcode:pipeline:planning');
    expect(joined).toContain('shipcode:claim:active');
    expect(joined).not.toMatch(/dispatch:(claude|codex|openrouter)/);
    expect(joined).not.toMatch(/`loop:(planning|executing|testing|shipping)`/);
    expect(joined).not.toMatch(/(^|[^:\w-])claim:active/);
    expect(joined).not.toMatch(/(^|[^:\w-])type:feature/);
  });
});
