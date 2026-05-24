// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadPanelBoardReviewDialog } from './ThreadPanelBoardReviewDialog';

describe('ThreadPanelBoardReviewDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('confirms with the shortcut when there are issues to review', () => {
    const onConfirm = vi.fn();

    render(<ThreadPanelBoardReviewDialog count={1} open onClose={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText('Review and align 1 issue?')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Enter',
      metaKey: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review board' }));

    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('disables confirmation when there are no eligible issues', () => {
    const onConfirm = vi.fn();

    render(<ThreadPanelBoardReviewDialog count={0} open onClose={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText('Review and align 0 issues?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review board' })).toBeDisabled();

    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Enter',
      metaKey: true,
    });

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
