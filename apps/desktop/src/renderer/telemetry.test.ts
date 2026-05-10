import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRendererException, syncRendererTelemetry } from './telemetry';

const sentryAdapter = vi.hoisted(() => ({
  init: vi.fn(),
  close: vi.fn(() => Promise.resolve(true)),
  captureException: vi.fn(),
}));

vi.mock('@sentry/electron/renderer', () => sentryAdapter);

describe('renderer telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = vi.fn(() =>
      Promise.resolve({ enabled: false, dsnConfigured: true, envDisabled: false }),
    );
  });

  it('initializes once when telemetry is enabled and closes when disabled', async () => {
    await syncRendererTelemetry({ enabled: true, dsnConfigured: true, envDisabled: false });
    await syncRendererTelemetry({ enabled: true, dsnConfigured: true, envDisabled: false });

    expect(sentryAdapter.init).toHaveBeenCalledTimes(1);

    await syncRendererTelemetry({ enabled: false, dsnConfigured: true, envDisabled: false });

    expect(sentryAdapter.close).toHaveBeenCalledWith(2000);
  });

  it('loads telemetry status through IPC and skips capture when disabled', async () => {
    await captureRendererException(new Error('disabled'));

    expect(window.shipcode.invoke).toHaveBeenCalledWith('telemetry:get-status');
    expect(sentryAdapter.captureException).not.toHaveBeenCalled();
  });

  it('captures renderer exceptions with context when enabled', async () => {
    const error = new Error('boom');
    window.shipcode.invoke = vi.fn(() =>
      Promise.resolve({ enabled: true, dsnConfigured: true, envDisabled: false }),
    );

    await syncRendererTelemetry({ enabled: true, dsnConfigured: true, envDisabled: false });
    await captureRendererException(error, {
      tags: { surface: 'renderer' },
      extra: { issueNumber: 42 },
    });

    expect(sentryAdapter.captureException).toHaveBeenCalledWith(error, {
      tags: { surface: 'renderer' },
      extra: { issueNumber: 42 },
    });
  });
});
