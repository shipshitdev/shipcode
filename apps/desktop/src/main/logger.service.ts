import log from 'electron-log/main';

log.initialize();
log.transports.file.level = 'debug';
log.transports.console.level = 'info';

export default log;

/** Routes process output metadata to the app log file without persisting raw content. */
export function logProcessOutput(type: string, data: string): void {
  log.debug(`[output:${type}] ${Buffer.byteLength(data, 'utf8')} bytes`);
}
