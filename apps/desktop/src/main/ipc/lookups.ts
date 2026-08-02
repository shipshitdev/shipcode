import type { Project, Thread } from '@shipcode/shared';
import type { Queries } from './types';

/**
 * Deliberately dependency-free: every IPC handler file needs these lookups, and
 * pulling them from `./helpers` would drag that module's `@shipcode/agents` /
 * `electron-log` import graph into handlers (and their tests) that need none of
 * it. Only `requireEnrichedProject` lives in `./helpers`, because enrichment is
 * what actually needs those dependencies.
 */

/**
 * Standard "row is missing" error for IPC lookups.
 *
 * These are thrown, never caught locally: the central `ipcMain.handle` wrapper
 * in `main/ipc.ts` clamps the message to first-line + ~280 chars via
 * `clampError` and logs the full error object to the main-process console.
 * Keep these as plain `Error`s with single-line messages so that contract holds.
 *
 * `context` is an optional suffix for call sites that re-read a row after a
 * mutation and need to say so (e.g. `after name update`).
 */
export function notFoundError(entity: string, id: string, context?: string): Error {
  return new Error(`${entity} ${id} not found${context ? ` ${context}` : ''}`);
}

/** Look up a project by id, throwing the standard not-found error when absent. */
export function requireProject(queries: Queries, projectId: string, context?: string): Project {
  const project = queries.projects.getById(projectId);
  if (!project) throw notFoundError('Project', projectId, context);
  return project;
}

/** Look up a thread by id, throwing the standard not-found error when absent. */
export function requireThread(queries: Queries, threadId: string, context?: string): Thread {
  const thread = queries.threads.getById(threadId);
  if (!thread) throw notFoundError('Thread', threadId, context);
  return thread;
}
