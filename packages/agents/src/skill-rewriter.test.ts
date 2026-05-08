import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  spawn: mockSpawn,
}));

vi.mock('./health-check', () => ({
  shellExecEnv: () => ({ PATH: '/usr/bin' }),
}));

import {
  buildSkillRewritePrompt,
  extractRewrittenSkill,
  rewriteSkillDraft,
} from './skill-rewriter';

const VALID_PLAN_SKILL =
  '---\nname: plan-generation\n---\nUse {{USER_PROMPT}} for {{THREAD_ID}} and emit {{OUTPUT_SCHEMA}}.';

function createFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (chunk: string) => boolean; end: () => void };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdinWrites: string[] = [];
  let stdinEnded = false;
  proc.stdin = {
    write: (chunk: string) => {
      stdinWrites.push(chunk);
      return true;
    },
    end: () => {
      stdinEnded = true;
    },
  };
  return {
    proc,
    stdinWrites,
    isStdinEnded: () => stdinEnded,
    close: (code: number, options?: { stdout?: string; stderr?: string }) => {
      if (options?.stdout) proc.stdout.emit('data', options.stdout);
      if (options?.stderr) proc.stderr.emit('data', options.stderr);
      proc.emit('close', code);
    },
  };
}

describe('rewriteSkillDraft', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds a prompt with project context and required slot constraints', () => {
    const prompt = buildSkillRewritePrompt({
      phase: 'plan-generation',
      currentContent: VALID_PLAN_SKILL,
      bundledContent: VALID_PLAN_SKILL,
      requiredSlots: ['USER_PROMPT', 'THREAD_ID', 'OUTPUT_SCHEMA'],
      userInstruction: 'adapt to Review column before Done',
      projectContext: 'GitHub Projects status mapping: human_review=Review, done=Done',
      cwd: '/repo',
    });

    expect(prompt).toContain('Phase: plan-generation');
    expect(prompt).toContain('{{USER_PROMPT}}, {{THREAD_ID}}, {{OUTPUT_SCHEMA}}');
    expect(prompt).toContain('human_review=Review');
    expect(prompt).toContain('shipcode-skill');
  });

  it('pipes the rewrite prompt through Claude stdin and returns valid skill content', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = rewriteSkillDraft({
      phase: 'plan-generation',
      currentContent: VALID_PLAN_SKILL,
      bundledContent: VALID_PLAN_SKILL,
      requiredSlots: ['USER_PROMPT', 'THREAD_ID', 'OUTPUT_SCHEMA'],
      userInstruction: 'make planner account for Ready, In progress, Review, Done columns',
      projectContext: 'GitHub Projects status mapping: in_progress=In progress',
      cwd: '/repo',
      cli: 'claude',
      modelId: 'claude-sonnet-4-6',
      reasoningEffort: 'low',
    });

    await Promise.resolve();

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', '--model', 'claude-sonnet-4-6', '--output-format', 'json']),
      expect.objectContaining({ cwd: '/repo', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(fake.stdinWrites[0]).toContain('Current skill draft');
    expect(fake.stdinWrites[0]).toContain('Ready, In progress, Review, Done');
    expect(fake.isStdinEnded()).toBe(true);

    fake.close(0, {
      stdout: `\`\`\`shipcode-skill\n${JSON.stringify({ content: VALID_PLAN_SKILL })}\n\`\`\``,
    });

    await expect(promise).resolves.toEqual({ content: VALID_PLAN_SKILL });
  });

  it('rejects rewritten content that loses required slots', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = rewriteSkillDraft({
      phase: 'plan-generation',
      currentContent: VALID_PLAN_SKILL,
      bundledContent: VALID_PLAN_SKILL,
      requiredSlots: ['USER_PROMPT', 'THREAD_ID', 'OUTPUT_SCHEMA'],
      userInstruction: 'shorten it',
      projectContext: '',
      cwd: '/repo',
      cli: 'codex',
      modelId: 'gpt-5.4-mini',
      reasoningEffort: 'low',
    });

    await Promise.resolve();

    fake.close(0, {
      stdout:
        '```shipcode-skill\n{"content":"---\\nname: plan-generation\\n---\\nNo slots here."}\n```',
    });

    await expect(promise).rejects.toThrow('Missing required slots');
  });

  it('rejects rewritten content that invents unsupported runtime slots', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = rewriteSkillDraft({
      phase: 'plan-generation',
      currentContent: VALID_PLAN_SKILL,
      bundledContent: VALID_PLAN_SKILL,
      requiredSlots: ['USER_PROMPT', 'THREAD_ID', 'OUTPUT_SCHEMA'],
      userInstruction: 'add workflow details',
      projectContext: '',
      cwd: '/repo',
      cli: 'claude',
    });

    await Promise.resolve();

    fake.close(0, {
      stdout:
        '```shipcode-skill\n{"content":"---\\nname: plan-generation\\n---\\nUse {{USER_PROMPT}} for {{THREAD_ID}}, emit {{OUTPUT_SCHEMA}}, and inspect {{WORKFLOW}}."}\n```',
    });

    await expect(promise).rejects.toThrow('unsupported slot');
  });
});

describe('extractRewrittenSkill', () => {
  it('extracts content from the fenced JSON envelope', () => {
    expect(
      extractRewrittenSkill(
        `\`\`\`shipcode-skill\n${JSON.stringify({ content: VALID_PLAN_SKILL })}\n\`\`\``,
      ),
    ).toEqual({ content: VALID_PLAN_SKILL });
  });
});
