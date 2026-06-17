import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isRepoSkillBundleKeyMock, seedRepoSkillBundleMock } = vi.hoisted(() => ({
  isRepoSkillBundleKeyMock: vi.fn(),
  seedRepoSkillBundleMock: vi.fn(),
}));

vi.mock('@shipcode/agents', () => ({
  isRepoSkillBundleKey: isRepoSkillBundleKeyMock,
  seedRepoSkillBundle: seedRepoSkillBundleMock,
}));

import { seedSkillsCommand } from './skills';

describe('seedSkillsCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    isRepoSkillBundleKeyMock.mockReturnValue(true);
    seedRepoSkillBundleMock.mockReturnValue({
      bundle: 'dev-loop',
      targetDir: '/repo/skills',
      files: [
        {
          path: 'skills/writing-prds/SKILL.md',
          absolutePath: '/repo/skills/writing-prds/SKILL.md',
          status: 'written',
        },
        {
          path: 'skills/writing-plans/SKILL.md',
          absolutePath: '/repo/skills/writing-plans/SKILL.md',
          status: 'skipped',
        },
      ],
    });
  });

  it('seeds the requested bundle into the current repo', () => {
    seedSkillsCommand('dev-loop', { force: true });

    expect(seedRepoSkillBundleMock).toHaveBeenCalledWith({
      bundle: 'dev-loop',
      cwd: process.cwd(),
      force: true,
    });
    expect(logSpy).toHaveBeenCalledWith('Seeded dev-loop skills into /repo/skills');
    expect(logSpy).toHaveBeenCalledWith('  Written: 1');
    expect(logSpy).toHaveBeenCalledWith('  Skipped: 1');
    expect(logSpy).not.toHaveBeenCalledWith('  Re-run with --force to overwrite existing files.');
  });

  it('defaults to the dev-loop bundle and reports skipped files', () => {
    seedSkillsCommand();

    expect(seedRepoSkillBundleMock).toHaveBeenCalledWith({
      bundle: 'dev-loop',
      cwd: process.cwd(),
      force: false,
    });
    expect(logSpy).toHaveBeenCalledWith('  Re-run with --force to overwrite existing files.');
  });

  it('exits for an unknown bundle', () => {
    isRepoSkillBundleKeyMock.mockReturnValueOnce(false);

    expect(() => seedSkillsCommand('unknown')).toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('Unknown skills bundle: unknown');
    expect(errorSpy).toHaveBeenCalledWith('Available bundles: dev-loop');
    expect(seedRepoSkillBundleMock).not.toHaveBeenCalled();
  });
});
