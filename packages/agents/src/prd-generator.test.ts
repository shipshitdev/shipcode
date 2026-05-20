import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  spawn: mockSpawn,
}));

vi.mock('./health-check', () => ({
  shellExecEnv: () => ({ PATH: '/usr/bin' }),
}));

import { buildPrdPrompt, enhancePrdDraft, extractPrd } from './prd-generator';
import { createFakeProc } from './test-fake-proc';

describe('enhancePrdDraft', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces Claude stdout result when the CLI exits non-zero with empty stderr', async () => {
    const fake = createFakeProc({ captureStdin: true });
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = enhancePrdDraft({
      draftBody: '',
      skillContent: 'skill contents',
      cwd: '/repo',
    });

    await Promise.resolve();

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', '--output-format', 'json']),
      expect.objectContaining({ cwd: '/repo', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(fake.stdinWrites).toHaveLength(1);
    expect(fake.isStdinEnded()).toBe(true);

    fake.close(1, {
      stdout:
        '{"type":"result","subtype":"success","is_error":true,"result":"You\\u2019ve hit your limit \\u00b7 resets 6am (Europe/Malta)"}',
    });

    await expect(promise).rejects.toThrow(
      'Claude CLI exited 1: You’ve hit your limit · resets 6am (Europe/Malta)',
    );
  });

  it('passes explicit Claude model without adding thinking tokens for low effort', async () => {
    const fake = createFakeProc({ captureStdin: true });
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = enhancePrdDraft({
      draftBody: '',
      skillContent: 'skill contents',
      cwd: '/repo',
      cli: 'claude',
      modelId: 'claude-sonnet-4-6',
      reasoningEffort: 'low',
    });

    await Promise.resolve();

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      [
        '-p',
        '--model',
        'claude-sonnet-4-6',
        '--output-format',
        'json',
        '--max-turns',
        '3',
        '--allowedTools',
        '',
      ],
      expect.objectContaining({ cwd: '/repo', stdio: ['pipe', 'pipe', 'pipe'] }),
    );

    fake.close(0, {
      stdout: '```shipcode-prd\n{"body":"# PRD: test\\n\\n## Executive Summary\\nOk"}\n```',
    });

    await expect(promise).resolves.toEqual({
      body: '# PRD: test\n\n## Executive Summary\nOk',
    });
  });

  it('rejects Codex CLI because it cannot run in no-tools mode', async () => {
    await expect(
      enhancePrdDraft({
        draftBody: '',
        skillContent: 'skill contents',
        cwd: '/repo',
        cli: 'codex',
        modelId: 'gpt-5.4-mini',
        reasoningEffort: 'low',
      }),
    ).rejects.toThrow('Codex PRD rewriting is disabled because it cannot run in no-tools mode');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('rejects Codex CLI without model args before spawning', async () => {
    await expect(
      enhancePrdDraft({
        draftBody: '',
        skillContent: 'skill contents',
        cwd: '/repo',
        cli: 'codex',
        reasoningEffort: 'low',
      }),
    ).rejects.toThrow('Codex PRD rewriting is disabled because it cannot run in no-tools mode');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('defaults to Claude without model args and preserves prompt frontmatter in stdin', async () => {
    const fake = createFakeProc({ captureStdin: true });
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = enhancePrdDraft({
      draftBody: '# PRD: draft',
      skillContent: '---\nname: writing-prds\n---\nSkill body',
      cwd: '/repo',
    });

    await Promise.resolve();

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '-p',
        '--output-format',
        'json',
        '--max-turns',
        '3',
        '--allowedTools',
        '',
      ]),
      expect.objectContaining({ cwd: '/repo', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(fake.stdinWrites[0]).toContain('---\nname: writing-prds\n---');
    expect(fake.stdinWrites[0]).toContain('# PRD: draft');

    fake.close(0, {
      stdout: '```shipcode-prd\n{"body":"# PRD: default\\n\\n## Executive Summary\\nOk"}\n```',
    });

    await expect(promise).resolves.toEqual({
      body: '# PRD: default\n\n## Executive Summary\nOk',
    });
  });
});

describe('buildPrdPrompt', () => {
  it('embeds skill content and the current draft without putting the prompt on argv', () => {
    const prompt = buildPrdPrompt('Current draft body', '---\nname: writing-prds\n---');

    expect(prompt).toContain('---\nname: writing-prds\n---');
    expect(prompt).toContain('Current draft body');
    expect(prompt).toContain('```shipcode-prd');
  });
});

describe('extractPrd', () => {
  it('rejects responses without the PRD envelope', () => {
    expect(() => extractPrd('plain text')).toThrow(/No `shipcode-prd`/);
  });

  it('rejects malformed PRD JSON envelopes', () => {
    expect(() => extractPrd('```shipcode-prd\n{"body":\n```')).toThrow(/Failed to parse PRD JSON/);
  });

  it('rejects envelopes without a non-empty body string', () => {
    expect(() => extractPrd('```shipcode-prd\n{"body":""}\n```')).toThrow(/PRD body is empty/);
    expect(() => extractPrd('```shipcode-prd\n{"prompt":"x"}\n```')).toThrow(
      /missing required `body`/,
    );
  });

  it('accepts opening fences with trailing metadata', () => {
    expect(extractPrd('```shipcode-prd json\n{"body":"# PRD: ok"}\n```')).toEqual({
      body: '# PRD: ok',
    });
  });
});
