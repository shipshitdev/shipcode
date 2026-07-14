import { describe, expect, it, vi } from 'vitest';
import {
  captureIpcFailure,
  captureMainException,
  capturePipelineFailure,
  configureMainTelemetry,
  getTelemetryDsn,
  getTelemetryStatus,
  isTelemetryDisabledByEnv,
  MainTelemetryController,
  resolveTelemetryStatus,
  type SentryMainAdapter,
} from './telemetry';

const { sentryMainAdapter } = vi.hoisted(() => ({
  sentryMainAdapter: {
    init: vi.fn(),
    close: vi.fn(async () => true),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
  },
}));

vi.mock('@sentry/electron/main', () => sentryMainAdapter);

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
    const beforeSend = (adapter.init as ReturnType<typeof vi.fn>).mock.calls[0][0].beforeSend as (
      event: Record<string, unknown> | null,
    ) => Record<string, unknown> | null;
    expect(beforeSend(null)).toBeNull();
    expect(
      beforeSend({
        request: { headers: { authorization: 'secret' } },
        extra: {
          tokenValue: 'abc123',
          nested: { rawPayload: 'raw', safe: 'value' },
        },
      }),
    ).toEqual({
      extra: {
        tokenValue: '[redacted]',
        nested: { rawPayload: '[redacted]', safe: 'value' },
      },
    });
    expect(controller.status({ telemetryEnabled: true })).toMatchObject({
      enabled: true,
      initialized: true,
    });

    controller.captureException(new Error('boom'), {
      tags: { surface: 'ipc' },
      extra: { rawOutput: 'secret', safe: 'value' },
    });
    controller.captureException(new Error('no context'));
    expect(adapter.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { surface: 'ipc' },
        extra: { rawOutput: '[redacted]', safe: 'value' },
      }),
    );
    expect(adapter.captureException).toHaveBeenCalledWith(expect.any(Error), undefined);

    await controller.configure({ telemetryEnabled: true });
    expect(adapter.init).toHaveBeenCalledTimes(1);

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

  it('disables initialized telemetry even when the adapter has no close method', async () => {
    const adapter = makeAdapter();
    delete adapter.close;
    const controller = new MainTelemetryController(async () => adapter, {
      SHIPCODE_SENTRY_DSN: 'dsn',
    });

    await controller.configure({ telemetryEnabled: true });
    await expect(controller.configure({ telemetryEnabled: false })).resolves.toMatchObject({
      enabled: false,
      initialized: false,
      disabledReason: 'disabled-by-user',
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
          longValue: `${'x'.repeat(497)}...`,
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

  it('uses the singleton main telemetry wrapper functions', async () => {
    vi.clearAllMocks();
    delete process.env.SHIPCODE_SENTRY_DSN;

    expect(getTelemetryStatus({ telemetryEnabled: true })).toMatchObject({
      enabled: false,
      dsnConfigured: false,
    });

    await configureMainTelemetry({ telemetryEnabled: true });
    expect(sentryMainAdapter.init).not.toHaveBeenCalled();

    captureMainException(new Error('main boom'), { tags: { surface: 'main' } });
    captureIpcFailure(new Error('ipc boom'), { channel: 'settings:get', elapsedMs: 12 });
    capturePipelineFailure({
      threadId: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      source: 'pipeline:phase',
      phase: 'failed',
      autonomous: true,
      requireApproval: false,
      failurePhase: 'executing',
      failureCount: 2,
      verificationRetries: 1,
      message: 'failed',
    });
    expect(sentryMainAdapter.captureException).not.toHaveBeenCalled();
    expect(sentryMainAdapter.captureMessage).not.toHaveBeenCalled();
    expect(sentryMainAdapter.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('initializes and uses the singleton telemetry adapter when configured', async () => {
    vi.clearAllMocks();
    process.env.SHIPCODE_SENTRY_DSN = 'singleton-dsn';
    process.env.SHIPCODE_ENVIRONMENT = 'test-singleton';

    await expect(configureMainTelemetry({ telemetryEnabled: true })).resolves.toMatchObject({
      enabled: true,
      initialized: true,
    });
    expect(sentryMainAdapter.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'singleton-dsn', environment: 'test-singleton' }),
    );

    captureMainException(new Error('main boom'));
    captureIpcFailure(new Error('ipc boom'), { channel: 'settings:get', elapsedMs: 12 });
    capturePipelineFailure({
      threadId: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      source: 'pipeline:phase',
      phase: 'failed',
      autonomous: true,
      requireApproval: false,
      failurePhase: 'executing',
      failureCount: 2,
      verificationRetries: 1,
      message: 'failed',
    });

    expect(sentryMainAdapter.captureException).toHaveBeenCalledTimes(2);
    expect(sentryMainAdapter.captureMessage).toHaveBeenCalledWith(
      'Pipeline failed in failed',
      expect.objectContaining({ tags: expect.objectContaining({ surface: 'pipeline' }) }),
    );
    delete process.env.SHIPCODE_SENTRY_DSN;
    delete process.env.SHIPCODE_ENVIRONMENT;
    await configureMainTelemetry({ telemetryEnabled: false });
  });
});
