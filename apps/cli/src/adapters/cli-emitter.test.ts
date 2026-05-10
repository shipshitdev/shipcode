import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCliEmitter } from './cli-emitter';

describe('createCliEmitter', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T12:34:56.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prints lifecycle pipeline events with stable timestamps', () => {
    const emitter = createCliEmitter();

    emitter.emit({ type: 'pipeline:phase', phase: 'planning' } as never);
    emitter.emit({
      type: 'pipeline:start-context',
      source: 'github',
      autonomous: true,
      requireApproval: false,
    } as never);
    emitter.emit({
      type: 'pipeline:start-context',
      source: 'manual',
      autonomous: false,
      requireApproval: true,
    } as never);
    emitter.emit({
      type: 'pipeline:approval-gate',
      outcome: 'approved',
      reviewDecision: 'approve',
      reasons: ['clean plan', 'low risk'],
    } as never);
    emitter.emit({ type: 'pipeline:verification-exhausted', retries: 2 } as never);

    expect(logSpy).toHaveBeenCalledWith('[12:34:56] Phase: planning');
    expect(logSpy).toHaveBeenCalledWith(
      '[12:34:56] Start: github autonomous=yes requireApproval=no',
    );
    expect(logSpy).toHaveBeenCalledWith(
      '[12:34:56] Start: manual autonomous=no requireApproval=yes',
    );
    expect(logSpy).toHaveBeenCalledWith(
      '[12:34:56] Approval gate: approved after approve (clean plan, low risk)',
    );
    expect(logSpy).toHaveBeenCalledWith('[12:34:56] Verification exhausted after 2 retries');
  });

  it('prints model routing with optional requested model, tokens, and cost', () => {
    const emitter = createCliEmitter();

    emitter.emit({
      type: 'pipeline:model-resolved',
      phase: 'executor',
      requestedModel: 'openrouter/auto',
      resolvedModel: 'anthropic/claude-sonnet-4.6',
      tokensUsed: { prompt: 1200, completion: 340 },
      costUsd: 0.12345,
    } as never);
    emitter.emit({
      type: 'pipeline:model-resolved',
      phase: 'verifier',
      requestedModel: 'gpt-5.4',
      resolvedModel: 'gpt-5.4',
      costUsd: 0.01,
    } as never);
    emitter.emit({
      type: 'pipeline:model-resolved',
      phase: 'planner',
      requestedModel: 'claude',
      resolvedModel: 'claude-sonnet-4.6',
      tokensUsed: { prompt: 10, completion: 5 },
      costUsd: null,
    } as never);
    emitter.emit({
      type: 'pipeline:model-resolved',
      phase: 'reviewer',
      requestedModel: 'codex',
      resolvedModel: 'gpt-5.5',
    } as never);

    expect(logSpy).toHaveBeenCalledWith(
      '[12:34:56] executor: routed to anthropic/claude-sonnet-4.6 via openrouter/auto (1200+340 tok, $0.1235)',
    );
    expect(logSpy).toHaveBeenCalledWith('[12:34:56] verifier: routed to gpt-5.4 ($0.0100)');
    expect(logSpy).toHaveBeenCalledWith(
      '[12:34:56] planner: routed to claude-sonnet-4.6 via claude (10+5 tok)',
    );
    expect(logSpy).toHaveBeenCalledWith('[12:34:56] reviewer: routed to gpt-5.5 via codex');
  });

  it('prints parsed artifact summaries and warnings', () => {
    const emitter = createCliEmitter();

    emitter.emit({
      type: 'plan:parsed',
      plan: { objective: 'Increase test coverage' },
    } as never);
    emitter.emit({
      type: 'review:parsed',
      review: {
        decision: 'changes_requested',
        confidence: 'high',
        findings: [{ severity: 'major', description: 'Missing regression test' }],
      },
    } as never);
    emitter.emit({
      type: 'review:parsed',
      review: {
        decision: 'approved',
        confidence: 'medium',
        findings: [],
      },
    } as never);
    emitter.emit({
      type: 'verification:parsed',
      verification: { result: 'passed' },
    } as never);
    emitter.emit({ type: 'skill:fallback', phase: 'execute', reason: 'missing skill' } as never);
    emitter.emit({
      type: 'workflow:warning',
      warning: { message: 'WORKFLOW.md is stale' },
    } as never);

    expect(logSpy).toHaveBeenCalledWith('[12:34:56] Plan generated: Increase test coverage');
    expect(logSpy).toHaveBeenCalledWith('[12:34:56] Review: changes_requested (high)');
    expect(logSpy).toHaveBeenCalledWith('  [major] Missing regression test');
    expect(logSpy).toHaveBeenCalledWith('[12:34:56] Review: approved (medium)');
    expect(logSpy).toHaveBeenCalledWith('[12:34:56] Verification: passed');
    expect(logSpy).toHaveBeenCalledWith('[12:34:56] Skill fallback: execute (missing skill)');
    expect(logSpy).toHaveBeenCalledWith('[12:34:56] WORKFLOW.md warning: WORKFLOW.md is stale');
  });

  it('ignores terminal and raw output events', () => {
    const emitter = createCliEmitter();

    emitter.emit({ type: 'terminal:event' } as never);
    emitter.emit({ type: 'pipeline:output' } as never);

    expect(logSpy).not.toHaveBeenCalled();
  });
});
