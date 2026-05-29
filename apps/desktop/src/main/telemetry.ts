import type { AppSettings, TelemetryStatus } from '@shipcode/shared';

const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);
const DEFAULT_CLOSE_TIMEOUT_MS = 2000;

type EnvLike = Record<string, string | undefined>;

export interface SentryMainAdapter {
  init: (options: Record<string, unknown>) => void;
  close?: (timeout?: number) => PromiseLike<boolean>;
  captureException: (exception: unknown, context?: Record<string, unknown>) => unknown;
  captureMessage: (message: string, context?: Record<string, unknown>) => unknown;
  addBreadcrumb: (breadcrumb: Record<string, unknown>) => void;
}

export interface TelemetryContext {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
}

export interface PipelineFailureTelemetry {
  threadId: string;
  projectId: string | null;
  githubIssueNumber: number | null;
  source: 'pipeline:phase' | 'pipeline:verification-exhausted';
  phase: string;
  autonomous: boolean;
  requireApproval: boolean | null;
  failurePhase: string | null;
  failureCount: number;
  verificationRetries: number;
  message: string | null;
}

function readEnv(name: string, env: EnvLike): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/**
 * Exported for focused telemetry status tests.
 *
 * @knipignore
 */
export function isTelemetryDisabledByEnv(env: EnvLike = process.env): boolean {
  const raw = readEnv('SHIPCODE_TELEMETRY_ENABLED', env) ?? readEnv('TELEMETRY_ENABLED', env);
  return raw ? DISABLED_VALUES.has(raw.toLowerCase()) : false;
}

/**
 * Exported for focused telemetry status tests.
 *
 * @knipignore
 */
export function getTelemetryDsn(env: EnvLike = process.env): string | null {
  return readEnv('SHIPCODE_SENTRY_DSN', env) ?? readEnv('SENTRY_DSN', env);
}

/**
 * Exported for focused telemetry status tests.
 *
 * @knipignore
 */
export function resolveTelemetryStatus(
  settings: Pick<AppSettings, 'telemetryEnabled'>,
  initialized = false,
  env: EnvLike = process.env,
): TelemetryStatus {
  const envDisabled = isTelemetryDisabledByEnv(env);
  const dsnConfigured = getTelemetryDsn(env) != null;
  const pendingConsent = settings.telemetryEnabled == null;
  const enabled = settings.telemetryEnabled === true && !envDisabled && dsnConfigured;

  return {
    enabled,
    initialized: enabled && initialized,
    envDisabled,
    dsnConfigured,
    pendingConsent,
    disabledReason: envDisabled
      ? 'disabled-by-env'
      : !dsnConfigured
        ? 'missing-dsn'
        : pendingConsent
          ? 'pending-consent'
          : settings.telemetryEnabled === false
            ? 'disabled-by-user'
            : null,
  };
}

function scrubValue(key: string, value: unknown): unknown {
  const lowerKey = key.toLowerCase();
  if (
    lowerKey.includes('prompt') ||
    lowerKey.includes('terminal') ||
    lowerKey.includes('raw') ||
    lowerKey.includes('token') ||
    lowerKey.includes('secret')
  ) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (!value || typeof value !== 'object' || value instanceof Error) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => scrubValue(key, entry));

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([entryKey, entryValue]) => [entryKey, scrubValue(entryKey, entryValue)]),
  );
}

function sanitizeContext(context?: TelemetryContext): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return {
    tags: Object.fromEntries(
      Object.entries(context.tags ?? {}).filter(([, value]) => value != null),
    ),
    extra: Object.fromEntries(
      Object.entries(context.extra ?? {}).map(([key, value]) => [key, scrubValue(key, value)]),
    ),
  };
}

function sanitizeEvent(event: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!event) return event;
  delete event.request;
  if (event.extra && typeof event.extra === 'object') {
    event.extra = scrubValue('extra', event.extra);
  }
  return event;
}

/**
 * Exported for focused telemetry lifecycle tests.
 *
 * @knipignore
 */
export class MainTelemetryController {
  private adapter: SentryMainAdapter | null = null;
  private loadingAdapter: Promise<SentryMainAdapter> | null = null;
  private initialized = false;

  constructor(
    private readonly loadAdapter: () => Promise<SentryMainAdapter>,
    private readonly env: EnvLike = process.env,
  ) {}

  status(settings: Pick<AppSettings, 'telemetryEnabled'>): TelemetryStatus {
    return resolveTelemetryStatus(settings, this.initialized, this.env);
  }

  async configure(settings: Pick<AppSettings, 'telemetryEnabled'>): Promise<TelemetryStatus> {
    const status = this.status(settings);

    if (!status.enabled) {
      if (this.initialized && this.adapter?.close) {
        await this.adapter.close(DEFAULT_CLOSE_TIMEOUT_MS);
      }
      this.initialized = false;
      return this.status(settings);
    }

    const adapter = await this.getAdapter();
    if (!this.initialized) {
      adapter.init({
        dsn: getTelemetryDsn(this.env),
        environment: readEnv('SHIPCODE_ENVIRONMENT', this.env) ?? this.env.NODE_ENV ?? 'production',
        beforeSend: sanitizeEvent,
      });
      this.initialized = true;
    }

    return this.status(settings);
  }

  captureException(error: unknown, context?: TelemetryContext): void {
    if (!this.initialized || !this.adapter) return;
    this.adapter.captureException(error, sanitizeContext(context));
  }

  captureMessage(message: string, context?: TelemetryContext): void {
    if (!this.initialized || !this.adapter) return;
    this.adapter.captureMessage(message, sanitizeContext(context));
  }

  addBreadcrumb(breadcrumb: Record<string, unknown>): void {
    if (!this.initialized || !this.adapter) return;
    this.adapter.addBreadcrumb(scrubValue('breadcrumb', breadcrumb) as Record<string, unknown>);
  }

  private getAdapter(): Promise<SentryMainAdapter> {
    if (this.adapter) return Promise.resolve(this.adapter);
    this.loadingAdapter ??= this.loadAdapter().then((adapter) => {
      this.adapter = adapter;
      return adapter;
    });
    return this.loadingAdapter;
  }
}

async function loadSentryMainAdapter(): Promise<SentryMainAdapter> {
  const sentry = (await import('@sentry/electron/main')) as SentryMainAdapter;
  return sentry;
}

const mainTelemetry = new MainTelemetryController(loadSentryMainAdapter);

export function getTelemetryStatus(
  settings: Pick<AppSettings, 'telemetryEnabled'>,
): TelemetryStatus {
  return mainTelemetry.status(settings);
}

export async function configureMainTelemetry(
  settings: Pick<AppSettings, 'telemetryEnabled'>,
): Promise<TelemetryStatus> {
  return mainTelemetry.configure(settings);
}

export function captureMainException(error: unknown, context?: TelemetryContext): void {
  mainTelemetry.captureException(error, context);
}

export function captureIpcFailure(
  error: unknown,
  context: { channel: string; elapsedMs: number },
): void {
  mainTelemetry.captureException(error, {
    tags: { surface: 'ipc', channel: context.channel },
    extra: { elapsedMs: context.elapsedMs },
  });
}

export interface TelemetryBreadcrumb {
  category: string;
  message: string;
  level?: 'debug' | 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}

/**
 * Record a Sentry breadcrumb on the main-process telemetry client. Breadcrumbs
 * are buffered by the SDK and attached to the next captured exception/message,
 * so a pipeline failure (or crashed IPC handler) arrives with the trail of
 * lifecycle steps that preceded it. No-ops until telemetry is initialized, and
 * the payload is scrubbed through the same redaction path as captured events.
 */
export function recordBreadcrumb(breadcrumb: TelemetryBreadcrumb): void {
  mainTelemetry.addBreadcrumb({
    type: 'default',
    level: breadcrumb.level ?? 'info',
    category: breadcrumb.category,
    message: breadcrumb.message,
    ...(breadcrumb.data ? { data: breadcrumb.data } : {}),
  });
}

export function capturePipelineFailure(context: PipelineFailureTelemetry): void {
  mainTelemetry.captureMessage(`Pipeline failed in ${context.phase}`, {
    tags: {
      surface: 'pipeline',
      source: context.source,
      phase: context.phase,
      threadId: context.threadId,
      projectId: context.projectId,
      githubIssueNumber: context.githubIssueNumber,
    },
    extra: {
      autonomous: context.autonomous,
      requireApproval: context.requireApproval,
      failurePhase: context.failurePhase,
      failureCount: context.failureCount,
      verificationRetries: context.verificationRetries,
      message: context.message,
    },
  });
}
