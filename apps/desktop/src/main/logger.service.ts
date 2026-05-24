import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';

log.initialize();
log.transports.file.level = 'debug';
log.transports.console.level = 'info';

export default log;

// Resolved lazily because `electron.app` is undefined when this module is
// imported under vitest (jsdom/node test envs don't run the Electron host).
// Eager top-level access crashed 5 desktop test files at module-load time.
let cachedEventsLogPath: string | null = null;
function getEventsLogPath(): string {
  if (cachedEventsLogPath) return cachedEventsLogPath;
  const dir = app?.isPackaged
    ? path.join(app.getPath('userData'), 'logs')
    : path.resolve(__dirname, '..', '..', 'logs');
  cachedEventsLogPath = path.join(dir, 'events.log');
  return cachedEventsLogPath;
}

export function getEventLogPath(): string {
  return getEventsLogPath();
}

export function getLogDirectoryPath(): string {
  try {
    return path.dirname(log.transports.file.getFile().path);
  } catch {
    return path.dirname(getEventsLogPath());
  }
}

if (app) {
  try {
    const eventsLogPath = getEventsLogPath();
    mkdirSync(path.dirname(eventsLogPath), { recursive: true });
    closeSync(openSync(eventsLogPath, 'a'));
  } catch (error) {
    log.warn('[events.log] init failed:', error);
  }
}

export function logEvent(type: string, payload: Record<string, unknown> = {}): void {
  try {
    const eventsLogPath = getEventsLogPath();
    mkdirSync(path.dirname(eventsLogPath), { recursive: true });
    appendFileSync(
      eventsLogPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        type,
        ...payload,
      })}\n`,
      'utf8',
    );
  } catch (error) {
    log.warn('[events.log] write failed:', error);
  }
}

/** Routes process output metadata to the app log file without persisting raw content. */
export function logProcessOutput(type: string, data: string): void {
  log.debug(`[output:${type}] ${Buffer.byteLength(data, 'utf8')} bytes`);
}
