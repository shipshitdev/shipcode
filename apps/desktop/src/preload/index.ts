import type { ShipCodeAPI } from '@shipcode/shared';
import { contextBridge, ipcRenderer } from 'electron';

const IS_DEV = process.env.NODE_ENV !== 'production';
const SLOW_IPC_THRESHOLD_MS = 150;
const IPC_SUMMARY_INTERVAL_MS = 5000;

type IpcMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
};

const ipcMetrics = new Map<string, IpcMetric>();

function recordIpcMetric(channel: string, elapsedMs: number, failed: boolean) {
  const current = ipcMetrics.get(channel) ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    errors: 0,
  };
  current.count += 1;
  current.totalMs += elapsedMs;
  current.maxMs = Math.max(current.maxMs, elapsedMs);
  if (failed) current.errors += 1;
  ipcMetrics.set(channel, current);
}

function summarizeArgs(args: unknown): Record<string, unknown> {
  if (args == null) return { hasArgs: false };
  if (Array.isArray(args)) return { hasArgs: true, argType: 'array', size: args.length };
  if (typeof args === 'object') {
    return {
      hasArgs: true,
      argType: 'object',
      keys: Object.keys(args as Record<string, unknown>).slice(0, 12),
    };
  }
  return { hasArgs: true, argType: typeof args };
}

if (IS_DEV) {
  setInterval(() => {
    if (ipcMetrics.size === 0) return;
    const snapshot = [...ipcMetrics.entries()]
      .map(([channel, metric]) => ({
        channel,
        count: metric.count,
        avgMs: Number((metric.totalMs / metric.count).toFixed(1)),
        maxMs: Number(metric.maxMs.toFixed(1)),
        errors: metric.errors,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    console.groupCollapsed('[shipcode][ipc] top channels');
    console.table(snapshot);
    console.groupEnd();
  }, IPC_SUMMARY_INTERVAL_MS);
}

const invoke: ShipCodeAPI['invoke'] = ((channel: string, args?: unknown) => {
  const startedAt = performance.now();
  return ipcRenderer.invoke(channel, args).then(
    (result) => {
      const elapsedMs = performance.now() - startedAt;
      if (IS_DEV) {
        recordIpcMetric(channel, elapsedMs, false);
        ipcRenderer.send('diagnostics:renderer-ipc', {
          channel,
          ok: true,
          elapsedMs: Number(elapsedMs.toFixed(1)),
          ...summarizeArgs(args),
        });
        if (elapsedMs >= SLOW_IPC_THRESHOLD_MS) {
          console.debug(`[shipcode][ipc] ${channel} ${elapsedMs.toFixed(1)}ms`, args);
        }
      }
      return result;
    },
    (error) => {
      const elapsedMs = performance.now() - startedAt;
      if (IS_DEV) {
        recordIpcMetric(channel, elapsedMs, true);
        ipcRenderer.send('diagnostics:renderer-ipc', {
          channel,
          ok: false,
          elapsedMs: Number(elapsedMs.toFixed(1)),
          error: error instanceof Error ? error.message : String(error),
          ...summarizeArgs(args),
        });
        console.warn(`[shipcode][ipc] ${channel} failed after ${elapsedMs.toFixed(1)}ms`, error);
      }
      throw error;
    },
  );
}) as ShipCodeAPI['invoke'];

const on: ShipCodeAPI['on'] = ((channel: string, callback: (...args: unknown[]) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}) as ShipCodeAPI['on'];

const api = Object.freeze({ invoke, on }) satisfies ShipCodeAPI;
contextBridge.exposeInMainWorld('shipcode', api);
