import log from 'electron-log/main';

log.initialize();
log.transports.file.level = 'debug';
log.transports.console.level = 'info';

export default log;

/** Routes raw process output to the app log file at debug level. */
export function logProcessOutput(type: string, data: string): void {
  log.debug(`[output:${type}] ${data.trimEnd()}`);
}
