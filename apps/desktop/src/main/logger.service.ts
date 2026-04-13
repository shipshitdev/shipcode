import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';

log.initialize();
log.transports.file.level = 'debug';
log.transports.console.level = 'info';

export default log;

const EVENTS_LOG_PATH = path.resolve(__dirname, '..', '..', 'logs', 'events.log');

try {
  mkdirSync(path.dirname(EVENTS_LOG_PATH), { recursive: true });
  closeSync(openSync(EVENTS_LOG_PATH, 'a'));
} catch (error) {
  log.warn('[events.log] init failed:', error);
}

export function logEvent(type: string, payload: Record<string, unknown> = {}): void {
  try {
    mkdirSync(path.dirname(EVENTS_LOG_PATH), { recursive: true });
    appendFileSync(
      EVENTS_LOG_PATH,
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
