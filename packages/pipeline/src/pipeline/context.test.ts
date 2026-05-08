import { describe, expect, it } from 'vitest';
import type { PipelineContext } from '../types';
import { resetPhaseState } from './context';

describe('resetPhaseState', () => {
  it('clears phase-local context fields', () => {
    const context = {
      stabilizationFeedback: 'fix tests',
      executionResumeContext: 'resume from checkpoint',
      previousPlanRawOutput: 'old plan',
      testOutput: 'test output',
      runtimeQaOutput: 'runtime output',
      runtimeQaCleanup: async () => {},
      cpuQueueStartedAt: 1,
      cpuQueueLastNotifiedAt: 2,
    } as PipelineContext;

    resetPhaseState(context);

    expect(context.stabilizationFeedback).toBeNull();
    expect(context.executionResumeContext).toBeNull();
    expect(context.previousPlanRawOutput).toBeNull();
    expect(context.testOutput).toBeNull();
    expect(context.runtimeQaOutput).toBeNull();
    expect(context.runtimeQaCleanup).toBeNull();
    expect(context.cpuQueueStartedAt).toBeNull();
    expect(context.cpuQueueLastNotifiedAt).toBeNull();
  });

  it('preserves selected phase-local fields for verifier evidence handoff', () => {
    const context = {
      stabilizationFeedback: 'fix tests',
      testOutput: 'typecheck passed',
      runtimeQaOutput: 'playwright passed',
      cpuQueueStartedAt: 1,
      cpuQueueLastNotifiedAt: 2,
    } as PipelineContext;

    resetPhaseState(context, ['testOutput', 'runtimeQaOutput']);

    expect(context.stabilizationFeedback).toBeNull();
    expect(context.testOutput).toBe('typecheck passed');
    expect(context.runtimeQaOutput).toBe('playwright passed');
    expect(context.cpuQueueStartedAt).toBeNull();
    expect(context.cpuQueueLastNotifiedAt).toBeNull();
  });
});
