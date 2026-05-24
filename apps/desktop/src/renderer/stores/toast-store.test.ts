import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, toastTone, useToastStore } from './toast-store';

describe('toast-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T00:00:00.000Z'));
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    useToastStore.setState({ toasts: [] });
  });

  it('adds newest toasts first and keeps the latest five', () => {
    toast.error('Failed', 'Try again');
    toast.success('Saved');
    toast.info('Queued');
    toast.info('Running');
    toast.info('Done');
    toast.info('Extra');

    const state = useToastStore.getState();
    expect(state.toasts).toHaveLength(5);
    expect(state.toasts.map((item) => item.title)).toEqual([
      'Extra',
      'Done',
      'Running',
      'Queued',
      'Saved',
    ]);
  });

  it('removes toasts by id and maps tones by kind', () => {
    toast.error('Failed');
    const [created] = useToastStore.getState().toasts;

    expect(created?.id).toMatch(/^toast-\d+-/);
    expect(toastTone('error')).toBe('danger');
    expect(toastTone('success')).toBe('success');
    expect(toastTone('info')).toBe('default');

    useToastStore.getState().removeToast(created?.id ?? '');

    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
