import type { TelemetryStatus } from '@shipcode/shared';

type RendererSentryAdapter = {
  init: () => void;
  close?: (timeout?: number) => PromiseLike<boolean>;
  captureException: (exception: unknown, context?: Record<string, unknown>) => unknown;
};

let adapter: RendererSentryAdapter | null = null;
let loadingAdapter: Promise<RendererSentryAdapter> | null = null;
let initialized = false;

async function getAdapter(): Promise<RendererSentryAdapter> {
  if (adapter) return adapter;
  loadingAdapter ??= import('@sentry/electron/renderer').then(
    (module) => module as RendererSentryAdapter,
  );
  adapter = await loadingAdapter;
  return adapter;
}

export async function syncRendererTelemetry(status?: TelemetryStatus): Promise<void> {
  const resolvedStatus = status ?? (await window.shipcode.invoke('telemetry:get-status'));

  if (!resolvedStatus.enabled) {
    if (initialized && adapter?.close) {
      await adapter.close(2000);
    }
    initialized = false;
    return;
  }

  if (initialized) return;
  const sentry = await getAdapter();
  sentry.init();
  initialized = true;
}

export async function captureRendererException(
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): Promise<void> {
  await syncRendererTelemetry();
  if (!initialized) return;
  const sentry = await getAdapter();
  sentry.captureException(error, context);
}
