import { describe, expect, it, vi } from 'vitest';
import {
  getTelemetryDsn,
  isTelemetryDisabledByEnv,
  MainTelemetryController,
  resolveTelemetryStatus,
  type SentryMainAdapter,
} from './telemetry';

function makeAdapter(): SentryMainAdapter {
  return {
    init: vi.fn(),
    close: vi.fn(async () => true),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
  };
}

describe('telemetry', () => {
  it('resolves env disables and dsn sources', () => {
    expect(isTelemetryDisabledByEnv({ SHIPCODE_TELEMETRY_ENABLED: 'false' })).toBe(true);
    expect(isTelemetryDisabledByEnv({ TELEMETRY_ENABLED: '0' })).toBe(true);
    expect(isTelemetryDisabledByEnv({ SHIPCODE_TELEMETRY_ENABLED: 'true' })).toBe(false);
    expect(getTelemetryDsn({ SHIPCODE_SENTRY_DSN: ' ship-dsn ' })).toBe('ship-dsn');
    expect(getTelemetryDsn({ SENTRY_DSN: 'fallback-dsn' })).toBe('fallback-dsn');
  });

  it('keeps telemetry disabled before consent and when env disables it', () => {
    expect(
      resolveTelemetryStatus({ telemetryEnabled: null }, false, { SHIPCODE_SENTRY_DSN: 'dsn' }),
    ).toMatchObject({
      enabled: false,
      pendingConsent: true,
      disabledReason: 'pending-consent',
    });
    expect(
      resolveTelemetryStatus({ telemetryEnabled: true }, false, {
        SHIPCODE_SENTRY_DSN: 'dsn',
        SHIPCODE_TELEMETRY_ENABLED: 'false',
      }),
    ).toMatchObject({
      enabled: false,
      envDisabled: true,
      disabledReason: 'disabled-by-env',
    });
  });

  it('initializes only after consent and closes when disabled', async () => {
    const adapter = makeAdapter();
    const controller = new MainTelemetryController(async () => adapter, {
      SHIPCODE_SENTRY_DSN: 'dsn',
      NODE_ENV: 'test',
    });

    await controller.configure({ telemetryEnabled: null });
    expect(adapter.init).not.toHaveBeenCalled();

    await controller.configure({ telemetryEnabled: true });
    expect(adapter.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'dsn', environment: 'test' }),
    );
    expect(controller.status({ telemetryEnabled: true })).toMatchObject({
      enabled: true,
      initialized: true,
    });

    controller.captureException(new Error('boom'), {
      tags: { surface: 'ipc' },
      extra: { rawOutput: 'secret', safe: 'value' },
    });
    expect(adapter.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { surface: 'ipc' },
        extra: { rawOutput: '[redacted]', safe: 'value' },
      }),
    );

    await controller.configure({ telemetryEnabled: false });
    expect(adapter.close).toHaveBeenCalledWith(2000);
    expect(controller.status({ telemetryEnabled: false })).toMatchObject({
      enabled: false,
      initialized: false,
      disabledReason: 'disabled-by-user',
    });
  });

  it('does not initialize when the dsn is missing', async () => {
    const adapter = makeAdapter();
    const controller = new MainTelemetryController(async () => adapter, {});

    await controller.configure({ telemetryEnabled: true });

    expect(adapter.init).not.toHaveBeenCalled();
    expect(controller.status({ telemetryEnabled: true })).toMatchObject({
      enabled: false,
      dsnConfigured: false,
      disabledReason: 'missing-dsn',
    });
  });

  it('sanitizes messages, breadcrumbs, arrays, and long strings before capture', async () => {
    const adapter = makeAdapter();
    const controller = new MainTelemetryController(async () => adapter, {
      SHIPCODE_SENTRY_DSN: 'dsn',
    });

    await controller.configure({ telemetryEnabled: true });
    controller.captureMessage('pipeline warning', {
      tags: {
        surface: 'pipeline',
        projectId: null,
        threadId: 'thread-1',
      },
      extra: {
        terminalOutput: 'raw terminal text',
        items: Array.from({ length: 25 }, (_, index) => ({ index, tokenValue: `token-${index}` })),
        longValue: 'x'.repeat(520),
      },
    });
    controller.addBreadcrumb({
      category: 'ipc',
      rawPayload: 'secret payload',
      safe: 'visible',
    });

    expect(adapter.captureMessage).toHaveBeenCalledWith(
      'pipeline warning',
      expect.objectContaining({
        tags: { surface: 'pipeline', threadId: 'thread-1' },
        extra: {
          terminalOutput: '[redacted]',
          items: expect.arrayContaining([expect.objectContaining({ tokenValue: '[redacted]' })]),
          longValue: `${'x'.repeat(500)}...`,
        },
      }),
    );
    expect(
      (adapter.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0][1]?.extra.items,
    ).toHaveLength(20);
    expect(adapter.addBreadcrumb).toHaveBeenCalledWith({
      category: 'ipc',
      rawPayload: '[redacted]',
      safe: 'visible',
    });
  });

  it('ignores capture calls before telemetry is initialized', () => {
    const adapter = makeAdapter();
    const controller = new MainTelemetryController(async () => adapter, {
      SHIPCODE_SENTRY_DSN: 'dsn',
    });

    controller.captureException(new Error('ignored'));
    controller.captureMessage('ignored');
    controller.addBreadcrumb({ category: 'ignored' });

    expect(adapter.captureException).not.toHaveBeenCalled();
    expect(adapter.captureMessage).not.toHaveBeenCalled();
    expect(adapter.addBreadcrumb).not.toHaveBeenCalled();
  });
});
