// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryConsentDialog } from './TelemetryConsentDialog';

function renderDialog(open = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TelemetryConsentDialog open={open} />
    </QueryClientProvider>,
  );
}

describe('TelemetryConsentDialog', () => {
  beforeEach(() => {
    window.shipcode.invoke = vi.fn(async () => undefined) as typeof window.shipcode.invoke;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('requires an explicit allow or decline choice', async () => {
    renderDialog();

    expect(screen.getByText('Error reporting')).toBeInTheDocument();
    expect(screen.getByText(/do not include prompts/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('settings:set', {
        telemetryEnabled: false,
      });
    });

    vi.mocked(window.shipcode.invoke).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => {
      expect(window.shipcode.invoke).toHaveBeenCalledWith('settings:set', {
        telemetryEnabled: true,
      });
    });
  });

  it('renders nothing when closed', () => {
    renderDialog(false);
    expect(screen.queryByText('Error reporting')).not.toBeInTheDocument();
  });
});
