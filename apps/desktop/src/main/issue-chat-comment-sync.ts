import { GhCli } from '@shipcode/agents/source';
import { clampError, GITHUB_POLL_INTERVAL_MS, type GitHubIssueComment } from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import type { IpcHandlerDeps, Queries } from './ipc/types';
import { isIssueChatSessionLive, sendIssueChatTurn } from './issue-chat-session';
import log from './logger.service';

interface IssueChatCommentSyncState {
  threadId: string;
  lastSeenCommentId: number | null;
  timer: ReturnType<typeof setInterval> | null;
  isPolling: boolean;
}

interface IssueChatCommentSyncDeps {
  threadId: string;
  queries: Queries;
  processManager: IpcHandlerDeps['processManager'];
  mainWindow: BrowserWindow;
}

interface IssueChatCommentSyncResult {
  checked: number;
  dispatched: number;
  ignored: number;
  lastSeenCommentId: number | null;
}

interface GithubCommentTurn {
  speaker: string;
  text: string;
}

const syncStates = new Map<string, IssueChatCommentSyncState>();

function sortComments(comments: GitHubIssueComment[]): GitHubIssueComment[] {
  return [...comments].sort((a, b) => {
    const byCreatedAt = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return byCreatedAt === 0 ? a.id - b.id : byCreatedAt;
  });
}

function latestCommentId(comments: GitHubIssueComment[]): number | null {
  return sortComments(comments).at(-1)?.id ?? null;
}

function stripMarker(body: string): string | null {
  const trimmed = body.trimStart();
  if (trimmed.toLowerCase().startsWith('/ask')) {
    return trimmed.slice('/ask'.length).trim();
  }
  if (trimmed.toLowerCase().startsWith('@shipcode')) {
    return trimmed.slice('@shipcode'.length).trim();
  }
  return null;
}

export function buildGithubIssueChatTurn(comment: GitHubIssueComment): GithubCommentTurn | null {
  const body = stripMarker(comment.body);
  if (!body) return null;
  const author = comment.author?.trim() || 'unknown';
  return {
    speaker: `github:${author}`.slice(0, 80),
    text: `GitHub issue comment from @${author} (untrusted user input):\n\n${body}`,
  };
}

async function listCommentsForThread(
  queries: Queries,
  threadId: string,
): Promise<GitHubIssueComment[]> {
  const thread = queries.threads.getById(threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  if (thread.githubIssueNumber == null) {
    throw new Error(`Thread ${threadId} is not linked to a GitHub issue`);
  }
  const project = queries.projects.getById(thread.projectId);
  if (!project) throw new Error(`Project not found: ${thread.projectId}`);
  const gh = new GhCli(project.path);
  return gh.listIssueComments(thread.githubIssueNumber);
}

export async function syncIssueChatCommentsOnce({
  threadId,
  queries,
  processManager,
  mainWindow,
  baselineOnly = false,
}: IssueChatCommentSyncDeps & { baselineOnly?: boolean }): Promise<IssueChatCommentSyncResult> {
  if (!isIssueChatSessionLive(threadId)) {
    stopIssueChatCommentSync(threadId);
    return { checked: 0, dispatched: 0, ignored: 0, lastSeenCommentId: null };
  }

  const state =
    syncStates.get(threadId) ??
    ({
      threadId,
      lastSeenCommentId: null,
      timer: null,
      isPolling: false,
    } satisfies IssueChatCommentSyncState);
  syncStates.set(threadId, state);

  if (state.isPolling) {
    return {
      checked: 0,
      dispatched: 0,
      ignored: 0,
      lastSeenCommentId: state.lastSeenCommentId,
    };
  }

  state.isPolling = true;
  try {
    const comments = sortComments(await listCommentsForThread(queries, threadId));
    if (baselineOnly || state.lastSeenCommentId == null) {
      state.lastSeenCommentId = latestCommentId(comments);
      return {
        checked: comments.length,
        dispatched: 0,
        ignored: comments.length,
        lastSeenCommentId: state.lastSeenCommentId,
      };
    }

    let dispatched = 0;
    let ignored = 0;
    for (const comment of comments) {
      if (comment.id <= state.lastSeenCommentId) continue;
      const turn = buildGithubIssueChatTurn(comment);
      if (!turn) {
        state.lastSeenCommentId = comment.id;
        ignored++;
        continue;
      }

      try {
        await sendIssueChatTurn({
          args: { threadId, text: turn.text, speaker: turn.speaker },
          queries,
          processManager,
          mainWindow,
        });
        state.lastSeenCommentId = comment.id;
        dispatched++;
      } catch (error) {
        log.error(
          `[issue-chat-sync] failed to dispatch comment ${comment.id} for ${threadId}: ${clampError(error)}`,
        );
        break;
      }
    }

    return {
      checked: comments.length,
      dispatched,
      ignored,
      lastSeenCommentId: state.lastSeenCommentId,
    };
  } finally {
    state.isPolling = false;
  }
}

export function startIssueChatCommentSync(deps: IssueChatCommentSyncDeps): void {
  const existing = syncStates.get(deps.threadId);
  if (existing?.timer) return;

  const settings = deps.queries.settings.get();
  const intervalMs =
    Number.isFinite(settings.githubPollingIntervalMs) && settings.githubPollingIntervalMs >= 5_000
      ? settings.githubPollingIntervalMs
      : GITHUB_POLL_INTERVAL_MS;
  const state: IssueChatCommentSyncState = {
    threadId: deps.threadId,
    lastSeenCommentId: existing?.lastSeenCommentId ?? null,
    timer: null,
    isPolling: false,
  };
  syncStates.set(deps.threadId, state);

  void syncIssueChatCommentsOnce({ ...deps, baselineOnly: true }).catch((error) => {
    log.error(`[issue-chat-sync] baseline failed for ${deps.threadId}: ${clampError(error)}`);
  });

  state.timer = setInterval(() => {
    void syncIssueChatCommentsOnce(deps).catch((error) => {
      log.error(`[issue-chat-sync] poll failed for ${deps.threadId}: ${clampError(error)}`);
    });
  }, intervalMs);
}

export function stopIssueChatCommentSync(threadId: string): boolean {
  const state = syncStates.get(threadId);
  if (!state) return false;
  if (state.timer) clearInterval(state.timer);
  syncStates.delete(threadId);
  return true;
}
