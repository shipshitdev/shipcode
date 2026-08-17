import { afterEach, describe, expect, it } from 'vitest';
import {
  completeInteractiveTerminalSession,
  getInteractiveTerminalSession,
  registerInteractiveTerminalSession,
  touchInteractiveTerminalSession,
  unregisterInteractiveTerminalSession,
} from './terminal-session-registry';

function session(threadId = 'thread-1') {
  return {
    processId: 'proc-1',
    threadId,
    cwd: '/tmp/worktree',
    provider: 'claude' as const,
    mode: 'interactive' as const,
    startedAt: 1_000,
    lastEventAt: 1_000,
    exitCode: null,
  };
}

describe('interactive terminal session registry', () => {
  afterEach(() => {
    unregisterInteractiveTerminalSession('thread-1');
    unregisterInteractiveTerminalSession('thread-2');
  });

  it('registers, touches, completes, and unregisters a live session', () => {
    registerInteractiveTerminalSession(session());

    const beforeTouch = getInteractiveTerminalSession('thread-1');
    expect(beforeTouch).toMatchObject({ processId: 'proc-1', exitCode: null, lastEventAt: 1_000 });

    touchInteractiveTerminalSession('thread-1');
    const touched = getInteractiveTerminalSession('thread-1');
    expect(touched?.lastEventAt).toBeGreaterThan(1_000);

    completeInteractiveTerminalSession('thread-1', 2);
    expect(getInteractiveTerminalSession('thread-1')).toMatchObject({
      exitCode: 2,
    });
    expect(getInteractiveTerminalSession('thread-1')?.lastEventAt).toBeGreaterThan(1_000);

    unregisterInteractiveTerminalSession('thread-1');
    expect(getInteractiveTerminalSession('thread-1')).toBeNull();
  });

  it('no-ops touch and complete when the session is missing', () => {
    expect(getInteractiveTerminalSession('missing')).toBeNull();
    expect(() => touchInteractiveTerminalSession('missing')).not.toThrow();
    expect(() => completeInteractiveTerminalSession('missing', 1)).not.toThrow();
  });
});
