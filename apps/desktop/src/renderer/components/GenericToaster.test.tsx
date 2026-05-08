// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../stores/toast-store';
import { GenericToaster } from './GenericToaster';

describe('GenericToaster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useToastStore.setState({ toasts: [] });
  });

  it('renders nothing when there are no queued toasts', () => {
    const { container } = render(<GenericToaster />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the newest three toasts and auto-removes them after the exit animation', () => {
    useToastStore.setState({
      toasts: [
        { id: 'toast-1', kind: 'error', title: 'First', body: 'Oldest' },
        { id: 'toast-2', kind: 'success', title: 'Second', body: 'Saved' },
        { id: 'toast-3', kind: 'info', title: 'Third' },
        { id: 'toast-4', kind: 'info', title: 'Fourth' },
      ],
    });

    render(<GenericToaster />);

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
    expect(screen.queryByText('Fourth')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByText('First').closest('.animate-toast-exit')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual(['toast-4']);
  });

  it('dismisses a toast manually through the notification close button', () => {
    useToastStore.setState({
      toasts: [{ id: 'toast-1', kind: 'success', title: 'Saved', body: 'Done' }],
    });

    render(<GenericToaster />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('Saved').closest('.animate-toast-exit')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
