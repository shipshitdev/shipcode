import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  execSyncMock,
  existsSyncMock,
  readFileSyncMock,
  enhancePrdDraftMock,
  createCliContextMock,
  requireOnboardingMock,
} = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  enhancePrdDraftMock: vi.fn(),
  createCliContextMock: vi.fn(),
  requireOnboardingMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
  },
}));

vi.mock('@shipcode/agents', () => ({
  enhancePrdDraft: enhancePrdDraftMock,
}));

vi.mock('../context', () => ({
  createCliContext: createCliContextMock,
}));

vi.mock('./guard', () => ({
  requireOnboarding: requireOnboardingMock,
}));

import { prdCommand } from './prd';

describe('prdCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireOnboardingMock.mockReturnValue(true);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('PRD skill content');
    createCliContextMock.mockReturnValue({
      settings: {
        get: () => ({
          prdRewriteCli: 'claude',
          prdRewriteClaudeModel: 'claude-sonnet-4-6',
          prdRewriteReasoningEffort: 'low',
        }),
      },
    });
    enhancePrdDraftMock.mockResolvedValue({
      body: '# Enhanced PRD',
    });
    execSyncMock.mockReturnValue(JSON.stringify([]));
  });

  it('returns before touching the repo when onboarding is incomplete', async () => {
    requireOnboardingMock.mockReturnValueOnce(false);

    await prdCommand('coverage');

    expect(createCliContextMock).not.toHaveBeenCalled();
    expect(enhancePrdDraftMock).not.toHaveBeenCalled();
  });

  it('exits with usage when keywords are blank', async () => {
    await expect(prdCommand('   ')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('Usage: shipcode prd <keywords or issue title>');
    expect(createCliContextMock).not.toHaveBeenCalled();
  });

  it('enhances an existing GitHub issue PRD', async () => {
    execSyncMock.mockReturnValueOnce(
      JSON.stringify([{ number: 12, title: 'Coverage PRD', body: 'Existing body' }]),
    );

    await prdCommand('Coverage "PRD"');

    expect(execSyncMock).toHaveBeenCalledWith(
      'gh issue list --search "Coverage \\"PRD\\"" --json number,title,body --limit 1',
      { cwd: process.cwd(), timeout: 15_000, encoding: 'utf-8' },
    );
    expect(enhancePrdDraftMock).toHaveBeenCalledWith({
      draftBody: 'Existing body',
      skillContent: 'PRD skill content',
      cwd: process.cwd(),
      cli: 'claude',
      modelId: 'claude-sonnet-4-6',
      reasoningEffort: 'low',
    });
    expect(logSpy).toHaveBeenCalledWith('Found existing issue #12: Coverage PRD');
    expect(logSpy).toHaveBeenCalledWith('\nTo update issue #12:');
    expect(logSpy).toHaveBeenCalledWith('  gh issue edit 12 --body-file <file>');
  });

  it('generates a new draft with the repo skill when issue search returns no matches', async () => {
    execSyncMock.mockReturnValueOnce(JSON.stringify([]));

    await prdCommand('New coverage plan');

    expect(readFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('skills/writing-prds/SKILL.md'),
      'utf-8',
    );
    expect(enhancePrdDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftBody: '# New coverage plan\n\nTODO: Fill in PRD sections.',
        skillContent: 'PRD skill content',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'No existing issue found for "New coverage plan". Generating new PRD...\n',
    );
    expect(logSpy).toHaveBeenCalledWith('\nTo create a new issue:');
    expect(logSpy).toHaveBeenCalledWith(
      '  gh issue create --title "New coverage plan" --body-file <file>',
    );
  });

  it('uses the fallback template and new issue instructions when search fails', async () => {
    existsSyncMock.mockReturnValueOnce(false);
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('gh unavailable');
    });

    await prdCommand('New coverage plan');

    expect(readFileSyncMock).not.toHaveBeenCalled();
    expect(enhancePrdDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftBody: '# New coverage plan\n\nTODO: Fill in PRD sections.',
        skillContent: expect.stringContaining('Write a comprehensive PRD'),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'No writing-prds skill found in repo. Using default template.\n',
    );
    expect(logSpy).toHaveBeenCalledWith(
      'No existing issue found for "New coverage plan". Generating new PRD...\n',
    );
    expect(logSpy).toHaveBeenCalledWith(
      '  gh issue create --title "New coverage plan" --body-file <file>',
    );
  });
});
