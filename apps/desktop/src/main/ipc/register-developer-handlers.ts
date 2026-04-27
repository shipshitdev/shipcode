import os from 'node:os';
import { checkSystemHealthWithAuth } from '@shipcode/agents';
import type { DeveloperInfo } from '@shipcode/shared';
import { app, shell } from 'electron';
import log from '../logger.service';
import type { UpdateService } from '../update-service';
import type { IpcHandlerDeps } from './types';

export function registerDeveloperHandlers(
  { ipcMain, mainWindow }: IpcHandlerDeps,
  updateService: UpdateService,
): void {
  ipcMain.handle('developer:get-info', async (): Promise<DeveloperInfo> => {
    const health = await checkSystemHealthWithAuth();
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
      osRelease: os.release(),
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

  ipcMain.handle('developer:open-log-directory', () => {
    try {
      const logFile = log.transports.file.getFile();
      shell.showItemInFolder(logFile.path);
    } catch (error) {
      log.warn('[developer] failed to resolve log file path:', error);
      shell.openPath(app.getPath('logs'));
    }
  });

  ipcMain.handle(
    'developer:set-log-level',
    (_event, { level }: { level: 'error' | 'warn' | 'info' | 'debug' }) => {
      log.transports.file.level = level;
    },
  );

  ipcMain.handle('update:get-status', () => updateService.getStatus());

  ipcMain.handle('update:check-now', async () => {
    return updateService.checkNow();
  });
}
