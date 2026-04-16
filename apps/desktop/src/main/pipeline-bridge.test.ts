import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createElectronEmitter } from './pipeline-bridge';

describe('createElectronEmitter', () => {
  it('fires the slot-open callback for awaiting_approval and terminal phases', () => {
    const thread = {
      id: 't1',
      projectId: 'project-1',
      title: 'Demo thread',
    };

    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    const onSlotFreed = vi.fn();
    const notifications = {
      fire: vi.fn(),
      dismissByThread: vi.fn(),
      markVerificationExhausted: vi.fn(),
    } as any;

    const emitter = createElectronEmitter(
      mainWindow,
      {
        activity: { create: vi.fn() } as any,
        threads: {
          getById: vi.fn(() => thread),
        } as any,
        notifications,
        onSlotFreed,
      },
    );

    emitter.emit({ type: 'pipeline:phase', threadId: 't1', phase: 'planning' });
    emitter.emit({ type: 'pipeline:phase', threadId: 't1', phase: 'awaiting_approval' });
    emitter.emit({ type: 'pipeline:phase', threadId: 't1', phase: 'failed' });
    emitter.emit({ type: 'pipeline:phase', threadId: 't1', phase: 'completed' });
    emitter.emit({ type: 'pipeline:phase', threadId: 't1', phase: 'idle' });

    expect(notifications.dismissByThread).toHaveBeenCalledWith('t1');
    expect(notifications.fire).toHaveBeenCalledWith('awaiting_approval', thread);
    expect(notifications.fire).toHaveBeenCalledWith('failed', thread);
    expect(notifications.fire).toHaveBeenCalledWith('completed', thread);
    expect(onSlotFreed).toHaveBeenCalledTimes(4);
  });
});
