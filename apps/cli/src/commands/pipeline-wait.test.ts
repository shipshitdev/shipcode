import { describe, expect, it, vi } from 'vitest';
import { waitForThreadTerminal } from './pipeline-wait';

describe('waitForThreadTerminal', () => {
  it('resolves when the thread reaches a terminal status', async () => {
    const getById = vi
      .fn()
      .mockReturnValueOnce({ id: 't1', status: 'planning' })
      .mockReturnValueOnce({ id: 't1', status: 'reviewing' })
      .mockReturnValueOnce({ id: 't1', status: 'approval' });

    const thread = await waitForThreadTerminal({ getById }, 't1', {
      intervalMs: 1,
      timeoutMs: 1000,
    });

    expect(thread.status).toBe('approval');
    expect(getById).toHaveBeenCalledTimes(3);
  });

  it('throws when the thread disappears', async () => {
    await expect(
      waitForThreadTerminal({ getById: () => null }, 'missing', {
        intervalMs: 1,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
