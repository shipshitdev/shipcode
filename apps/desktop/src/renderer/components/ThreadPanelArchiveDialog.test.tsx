// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadPanelArchiveDialog } from './ThreadPanelArchiveDialog';

afterEach(() => {
  cleanup();
});

describe('ThreadPanelArchiveDialog', () => {
  it('archives a single issue on cmd-enter', () => {
    const onConfirm = vi.fn();

    render(
      <ThreadPanelArchiveDialog open issueNumber={42} onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Archive issue #42?')).toBeInTheDocument();
  });

  it('renders the bulk archive title', () => {
    render(<ThreadPanelArchiveDialog open count={3} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByText('Archive 3 done issues?')).toBeInTheDocument();
  });
});
