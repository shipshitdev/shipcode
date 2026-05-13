import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import {
  buildContinuationPrompt,
  buildTestFailureFingerprint,
  extractExecutionErrorSnippet,
  extractImplicatedFiles,
  extractTestFailureSummary,
  normalizeFeatureQaResults,
  resolveWorktreeDiffBase,
  worktreeHasChanges,
} from './execution-phases';

const { mockExecFileSync } = vi.hoisted(() => ({ mockExecFileSync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: mockExecFileSync,
  };
});

describe('extractExecutionErrorSnippet', () => {
  it('returns empty when transcript ends with a shipcode-plan fence', () => {
    const raw = [
      'Some interim chatter',
      '```shipcode-plan',
      '{',
      '  "id": "plan-20260427T154500Z-issue56",',
      '  "threadId": "uKKI_0AnxPOjlKaSwMCkK",',
      '  "objective": "thing"',
      '}',
      '```',
    ].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Some interim chatter');
  });

  it('skips JSON-looking fields and finds the previous plain-text execution error', () => {
    const raw = ['Real failure message', '"result": "structured field"', ']', '}'].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Real failure message');
  });

  it('extracts a structured error from a streaming JSON event', () => {
    const raw = [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","is_error":true,"result":"Tool call denied: write file"}',
    ].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Tool call denied: write file');
  });

  it('skips malformed JSON events while scanning for execution errors', () => {
    const raw = ['Plain failure after malformed event', '{"type":"result",'].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Plain failure after malformed event');
  });

  it('extracts subtype error streaming events', () => {
    const raw = '{"type":"result","subtype":"error","result":"Sandbox denied write"}';
    expect(extractExecutionErrorSnippet(raw)).toBe('Sandbox denied write');
  });

  it('extracts a top-level error field when present', () => {
    const raw = '{"error":"ENOENT: missing repo"}';
    expect(extractExecutionErrorSnippet(raw)).toBe('ENOENT: missing repo');
  });

  it('skips bare JSON braces and returns the last plain-text line', () => {
    const raw = ['Network timeout while pushing branch', '{', '  "type": "result"', '}'].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Network timeout while pushing branch');
  });

  it('caps snippet at 280 characters', () => {
    const long = `${'x'.repeat(400)}`;
    expect(extractExecutionErrorSnippet(long).length).toBe(280);
  });

  it('returns empty when no usable text remains', () => {
    expect(extractExecutionErrorSnippet('```\n```\n{}\n[]\n')).toBe('');
  });
});

describe('execution phase helpers', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('builds default and custom continuation prompts', () => {
    const context = {
      turnCount: 3,
      workflowPolicy: {
        continuationPromptTemplate: null,
      },
    } as PipelineContext;

    expect(buildContinuationPrompt(context, 'Verifier failed')).toContain(
      'Prior failure reason: Verifier failed',
    );

    context.workflowPolicy.continuationPromptTemplate =
      'Turn {{ turn_count }}: {{ prior_failure_reason }}';
    expect(buildContinuationPrompt(context, 'Fix tests')).toBe('Turn 3: Fix tests');

    context.workflowPolicy.continuationPromptTemplate = 'No variables here';
    expect(buildContinuationPrompt(context, 'Ignored')).toBe('No variables here');
  });

  it('normalizes feature QA result evidence paths', () => {
    expect(
      normalizeFeatureQaResults([
        {
          flowId: 'flow-0',
          passed: true,
          summary: 'missing evidence',
        },
        {
          flowId: 'flow-1',
          passed: true,
          summary: 'ok',
          evidencePaths: null,
        },
        {
          flowId: 'flow-2',
          passed: false,
          summary: 'bad',
          evidencePaths: ['shot.png'],
        },
      ] as never),
    ).toEqual([
      {
        flowId: 'flow-0',
        passed: true,
        summary: 'missing evidence',
        evidencePaths: undefined,
      },
      {
        flowId: 'flow-1',
        passed: true,
        summary: 'ok',
        evidencePaths: undefined,
      },
      {
        flowId: 'flow-2',
        passed: false,
        summary: 'bad',
        evidencePaths: ['shot.png'],
      },
    ]);
  });

  it('extracts test failure summaries across common runners', () => {
    expect(extractTestFailureSummary('')).toBe('Tests failed (no output captured)');
    expect(extractTestFailureSummary('  FAIL packages/foo.test.ts\nstack')).toBe(
      'FAIL packages/foo.test.ts',
    );
    expect(extractTestFailureSummary('  × packages/foo.test.ts > breaks')).toBe(
      '× packages/foo.test.ts > breaks',
    );
    expect(extractTestFailureSummary('done\n2 failed, 1 passed')).toBe('2 failed, 1 passed');
    expect(extractTestFailureSummary('done\n1 error, 3 passed')).toBe('1 error, 3 passed');
    expect(extractTestFailureSummary('--- FAIL: TestFoo (0.01s)')).toBe(
      '--- FAIL: TestFoo (0.01s)',
    );
    expect(extractTestFailureSummary('noise\nError: bad thing')).toBe('Error: bad thing');
    expect(extractTestFailureSummary('noise\nlast line')).toBe('last line');
    expect(extractTestFailureSummary(`${'x'.repeat(400)}`)).toHaveLength(280);
  });

  it('extracts implicated test files and fingerprints stable failure output', () => {
    expect(
      extractImplicatedFiles(
        './packages/foo/src/a.test.ts packages/foo/src/a.test.ts apps/web/b.spec.tsx src/c.ts',
      ),
    ).toEqual(['packages/foo/src/a.test.ts', 'apps/web/b.spec.tsx']);

    const first = buildTestFailureFingerprint(
      'bun test',
      'FAIL packages/foo.test.ts\nAssertionError: no at file.ts:12:4\nDuration 41ms',
    );
    const second = buildTestFailureFingerprint(
      'bun test',
      'FAIL packages/foo.test.ts\nAssertionError: no at file.ts:99:1\nDuration 2s',
    );

    expect(first.summary).toBe('FAIL packages/foo.test.ts');
    expect(first.implicatedFiles).toEqual(['packages/foo.test.ts']);
    expect(first.outputExcerpt).toContain('AssertionError');
    expect(first.fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(extractImplicatedFiles('no test files mentioned')).toEqual([]);
  });

  it('detects worktree changes from status, fork-point diff, and git failures', () => {
    const context = {
      projectPath: '/project',
      worktreePath: '/worktree',
      forkPointSha: 'base',
    } as PipelineContext;

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return ' M src/a.ts\n';
      return '';
    });
    expect(worktreeHasChanges(context)).toBe(true);

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') return 'src/a.ts\n';
      return '';
    });
    expect(worktreeHasChanges(context)).toBe(true);

    mockExecFileSync.mockImplementation(() => '');
    expect(worktreeHasChanges(context)).toBe(false);
    expect(worktreeHasChanges({ projectPath: '/project' } as PipelineContext)).toBe(false);
    expect(
      worktreeHasChanges({ projectPath: '/project', forkPointSha: 'base' } as PipelineContext),
    ).toBe(false);

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'merge-base') return 'merge-base-sha\n';
      if (args[0] === 'diff' && args.includes('merge-base-sha..HEAD')) return 'src/a.ts\n';
      return '';
    });
    expect(
      worktreeHasChanges({
        projectPath: '/project',
        forkPointSha: '',
        baseBranch: 'main',
      } as PipelineContext),
    ).toBe(true);

    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(
      worktreeHasChanges({ projectPath: '/project', forkPointSha: '' } as PipelineContext),
    ).toBe(true);
  });

  it('resolves a diff base from fork point, base branch merge-base, then previous commit', () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      return '';
    });
    expect(
      resolveWorktreeDiffBase({
        projectPath: '/project',
        forkPointSha: 'base',
      } as PipelineContext),
    ).toBe('base');

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'merge-base' && args[1] === 'main') return 'merge-base-sha\n';
      return '';
    });
    expect(
      resolveWorktreeDiffBase({
        projectPath: '/project',
        forkPointSha: '',
        baseBranch: 'main',
      } as PipelineContext),
    ).toBe('merge-base-sha');

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[2] === 'stale^{commit}') {
        throw new Error('missing fork point');
      }
      if (args[0] === 'merge-base') throw new Error('missing base');
      if (args[0] === 'rev-parse' && args[1] === 'HEAD~1') return 'parent-sha\n';
      return '';
    });
    expect(
      resolveWorktreeDiffBase({
        projectPath: '/project',
        forkPointSha: 'stale',
        baseBranch: 'missing',
      } as PipelineContext),
    ).toBe('parent-sha');
  });
});
