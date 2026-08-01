import { clampError } from '@shipcode/shared';
import log from '../logger.service';
import { PipelineScheduler } from '../pipeline-scheduler';
import { sendGithubIssuesUpdated } from './helpers';
import { requireProject } from './lookups';
import type { IpcHandlerDeps } from './types';

const QUICK_TITLE_MAX = 60;

/**
 * Exported for focused title truncation tests.
 *
 * @knipignore
 */
export function deriveQuickTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= QUICK_TITLE_MAX) return trimmed;
  const cut = trimmed
    .slice(0, QUICK_TITLE_MAX)
    .replace(/\s+\S*$/, '')
    .trim();
  return cut || trimmed.slice(0, QUICK_TITLE_MAX);
}

export function registerQuickTaskHandlers({
  ipcMain,
  mainWindow,
  queries,
  pipeline,
  emitter,
  ghSync,
}: IpcHandlerDeps): void {
  const scheduler = new PipelineScheduler({
    queries,
    pipeline,
    emitter,
    getMainWindow: () => mainWindow,
    ghSync,
  });

  ipcMain.handle(
    'pipeline:create-quick-task',
    async (_event, { projectId, text }: { projectId: string; text: string }) => {
      requireProject(queries, projectId);

      const trimmed = text.trim();
      if (!trimmed) throw new Error('Quick task text is empty');

      const title = deriveQuickTitle(trimmed);

      const thread = queries.threads.create(projectId, trimmed, title, 'pipeline');
      const issue = queries.githubIssues.insertQuickTask({
        projectId,
        title,
        body: trimmed,
        threadId: thread.id,
      });
      queries.threads.setGithubIssueNumber(thread.id, issue.issueNumber);

      sendGithubIssuesUpdated(mainWindow, queries, projectId);

      // Fire-and-forget the scheduler launch. A failure here must mark the
      // cache row as failed so it doesn't sit stuck in `queued` forever.
      void scheduler.startQuickTaskOrQueue(projectId, issue.issueNumber).catch((err) => {
        log.error('[quick-task] launch failed:', err);
        try {
          queries.githubIssues.updatePipelineStatus(issue.id, 'failed');
          queries.threads.recordFailure(thread.id, clampError(err));
          sendGithubIssuesUpdated(mainWindow, queries, projectId);
        } catch (writeErr) {
          log.error('[quick-task] failed to record failure:', writeErr);
        }
      });

      return { issue };
    },
  );
}
