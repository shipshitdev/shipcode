import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, logMock } = vi.hoisted(() => ({
  appMock: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/shipcode-user-data'),
  },
  logMock: {
    initialize: vi.fn(),
    transports: {
      file: {
        level: '',
        getFile: vi.fn(() => ({ path: '/tmp/shipcode-logs/main.log' })),
      },
      console: {
        level: '',
      },
    },
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: appMock,
}));

vi.mock('electron-log/main', () => ({
  default: logMock,
}));

describe('logger.service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    appMock.isPackaged = false;
    appMock.getPath.mockReturnValue('/tmp/shipcode-user-data');
    logMock.transports.file.level = '';
    logMock.transports.console.level = '';
    logMock.transports.file.getFile.mockReturnValue({ path: '/tmp/shipcode-logs/main.log' });
  });

  it('initializes transports and resolves log paths for development builds', async () => {
    const logger = await import('./logger.service');

    expect(logMock.initialize).toHaveBeenCalledTimes(1);
    expect(logMock.transports.file.level).toBe('debug');
    expect(logMock.transports.console.level).toBe('info');
    expect(logger.getEventLogPath()).toMatch(/apps\/desktop\/logs\/events\.log$/);
    expect(logger.getLogDirectoryPath()).toBe('/tmp/shipcode-logs');
  });

  it('uses userData for packaged event logs and writes structured event records', async () => {
    appMock.isPackaged = true;
    appMock.getPath.mockReturnValue(`/tmp/shipcode-user-data-${Date.now()}`);
    const logger = await import('./logger.service');

    logger.logEvent('pipeline.started', { threadId: 'thread-1', count: 2 });

    const eventPath = logger.getEventLogPath();
    expect(eventPath).toMatch(/\/tmp\/shipcode-user-data-\d+\/logs\/events\.log$/);
    const content = fs.readFileSync(eventPath, 'utf8');
    expect(content).toContain('"type":"pipeline.started"');
    expect(content).toContain('"threadId":"thread-1"');
  });

  it('falls back to the event log directory and logs process output byte counts', async () => {
    logMock.transports.file.getFile.mockImplementation(() => {
      throw new Error('no file transport');
    });
    const logger = await import('./logger.service');

    expect(logger.getLogDirectoryPath()).toMatch(/apps\/desktop\/logs$/);
    logger.logProcessOutput('stdout', 'hello');

    expect(logMock.debug).toHaveBeenCalledWith('[output:stdout] 5 bytes');
  });
});
