import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GhCli } from '@shipcode/agents';
import type { PullRequestDetailResponse } from '@shipcode/shared';
import log from '../logger.service';
import type { IpcHandlerDeps } from './types';

export function registerPullRequestHandlers({ ipcMain, queries }: IpcHandlerDeps): void {
  // --- github:list-prs ---
  ipcMain.handle(
    'github:list-prs',
    async (
      _event,
      { projectId, filter, limit }: { projectId: string; filter?: string; limit?: number },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      const cli = new GhCli(project.path);
      const result = await cli.listPullRequests({ state: filter as never, limit });
      log.info(
        `[pr] listed ${result.length} PRs for project ${projectId} (filter=${filter ?? 'open'})`,
      );
      return result;
    },
  );

  // --- github:get-pr-detail ---
  ipcMain.handle(
    'github:get-pr-detail',
    async (
      _event,
      { projectId, prNumber }: { projectId: string; prNumber: number },
    ): Promise<PullRequestDetailResponse> => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      const cli = new GhCli(project.path);
      const result = await cli.getPullRequestDetail(prNumber);
      const linkedIssue = queries.githubIssues.getByLinkedPrNumber(projectId, prNumber);
      const linkedThreadId = linkedIssue?.threadId ?? null;
      const diffs = linkedThreadId ? queries.diffs.list(linkedThreadId) : [];
      log.info(`[pr] fetched detail for PR #${prNumber} in project ${projectId}`);
      return {
        ...result,
        linkedThreadId,
        diffs,
      };
    },
  );

  // --- skills:load-content ---
  ipcMain.handle('skills:load-content', async (_event, { name }: { name: string }) => {
    const skillPath = path.join(os.homedir(), '.claude', 'skills', name, 'SKILL.md');
    try {
      const content = await fs.readFile(skillPath, 'utf-8');
      return content;
    } catch {
      log.info(`[skills] skill not found at ${skillPath}`);
      return null;
    }
  });
}
