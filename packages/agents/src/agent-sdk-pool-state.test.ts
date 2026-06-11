import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPoolStateForTests,
  classifyPoolExhaustion,
  clearPoolExhausted,
  getPoolState,
  isPoolExhausted,
  markPoolExhausted,
} from './agent-sdk-pool-state';

afterEach(() => {
  __resetPoolStateForTests();
  delete process.env.SHIPCODE_SIMULATE_POOL_EXHAUSTED;
  vi.useRealTimers();
});

describe('classifyPoolExhaustion', () => {
  it('never classifies a successful (exit 0) run as exhaustion', () => {
    expect(classifyPoolExhaustion('agent sdk credit pool exhausted', '', 0)).toBe(false);
  });

  it('matches known exhaustion vocabulary on a non-zero exit', () => {
    expect(classifyPoolExhaustion('', 'Your Agent SDK credit has run out', 1)).toBe(true);
    expect(classifyPoolExhaustion('usage limit reached', '', 1)).toBe(true);
    expect(classifyPoolExhaustion('', 'insufficient credits', 1)).toBe(true);
    expect(classifyPoolExhaustion('monthly credit exhausted', '', 2)).toBe(true);
  });

  it('does not match unrelated failures', () => {
    expect(classifyPoolExhaustion('TypeError: undefined is not a function', 'stack', 1)).toBe(
      false,
    );
    expect(classifyPoolExhaustion('', 'connection refused', 1)).toBe(false);
  });

  it('honors an injected override matcher', () => {
    expect(classifyPoolExhaustion('anything', '', 1, ({ exitCode }) => exitCode === 1)).toBe(true);
    expect(classifyPoolExhaustion('agent sdk', '', 1, () => false)).toBe(false);
  });
});

describe('pool flag lifecycle', () => {
  it('starts clear', () => {
    expect(isPoolExhausted()).toBe(false);
    expect(getPoolState()).toMatchObject({ exhausted: false, detectedAt: null, reason: null });
  });

  it('mark sets the flag with reason + timestamp; clear resets it', () => {
    markPoolExhausted('boom');
    expect(isPoolExhausted()).toBe(true);
    const state = getPoolState();
    expect(state.exhausted).toBe(true);
    expect(state.reason).toBe('boom');
    expect(typeof state.detectedAt).toBe('number');
    clearPoolExhausted();
    expect(isPoolExhausted()).toBe(false);
  });

  it('the simulate env var forces exhaustion regardless of state', () => {
    process.env.SHIPCODE_SIMULATE_POOL_EXHAUSTED = '1';
    expect(isPoolExhausted()).toBe(true);
    expect(getPoolState().exhausted).toBe(true);
  });

  it('auto-expires after the 24h cooldown window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T00:00:00Z'));
    markPoolExhausted();
    expect(isPoolExhausted()).toBe(true);
    // +25h — past the cooldown
    vi.setSystemTime(new Date('2026-06-16T01:00:00Z'));
    expect(isPoolExhausted()).toBe(false);
  });
});
