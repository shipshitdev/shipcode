// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InAppNotification } from './InAppNotification';

afterEach(() => {
  cleanup();
});

describe('InAppNotification', () => {
  it('renders compact content with click and dismiss actions', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();

    render(
      <InAppNotification
        title="Plan ready"
        description="Review required before execution."
        tone="warning"
        onClick={onClick}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText('Plan ready')).toBeInTheDocument();
    expect(screen.getByText('Review required before execution.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Plan ready/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
