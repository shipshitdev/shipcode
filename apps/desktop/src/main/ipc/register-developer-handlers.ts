import os from 'node:os';
import { checkSystemHealthWithAuth } from '@shipcode/agents';
import type { DeveloperInfo } from '@shipcode/shared';
import { app, shell } from 'electron';
import log, { getEventLogPath, getLogDirectoryPath } from '../logger.service';
import type { UpdateService } from '../update-service';
import type { IpcHandlerDeps } from './types';

const IS_E2E = process.env.SHIPCODE_E2E === '1';

export function registerDeveloperHandlers(
  { ipcMain, mainWindow, processManager, resourceMonitor }: IpcHandlerDeps,
  updateService: UpdateService,
): void {
  ipcMain.handle('developer:get-info', async (): Promise<DeveloperInfo> => {
    if (IS_E2E) {
      return {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform,
        osRelease: os.release(),
        logDirectoryPath: getLogDirectoryPath(),
        eventLogPath: getEventLogPath(),
        cliVersions: {
          claude: 'e2e',
          codex: 'e2e',
          git: 'e2e',
          gh: 'e2e',
        },
      };
    }

    const health = await checkSystemHealthWithAuth();
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
      osRelease: os.release(),
      logDirectoryPath: getLogDirectoryPath(),
      eventLogPath: getEventLogPath(),
      cliVersions: {
        claude: health.claude.version,
        codex: health.codex.version,
        git: health.git.version,
        gh: health.gh.version,
      },
    };
  });

  ipcMain.handle('developer:open-devtools', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  ipcMain.handle('developer:open-log-directory', async () => {
    try {
      const openError = await shell.openPath(getLogDirectoryPath());
      if (openError) throw new Error(openError);
    } catch (error) {
      log.warn('[developer] failed to resolve log file path:', error);
      const fallbackError = await shell.openPath(app.getPath('logs'));
      if (fallbackError) throw new Error(fallbackError);
    }
  });

  ipcMain.handle(
    'developer:set-log-level',
    (_event, { level }: { level: 'error' | 'warn' | 'info' | 'debug' }) => {
      log.transports.file.level = level;
    },
  );

  ipcMain.handle('process:list-resource-usage', () => {
    if (resourceMonitor) return resourceMonitor.getSnapshot();
    return {
      capturedAt: new Date().toISOString(),
      cpuPercent: 0,
      cpuCoreCount: os.cpus().length,
      highCpu: false,
      tasks: [],
    };
  });

  ipcMain.handle('process:kill', (_event, { processId }: { processId: string }) => {
    processManager.kill(processId);
  });

  ipcMain.handle('update:get-status', () => updateService.getStatus());

  ipcMain.handle('update:check-now', async () => {
    return updateService.checkNow();
  });
}
