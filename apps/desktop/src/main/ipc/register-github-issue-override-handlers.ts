import {
  clampError,
  type ExecutorModel,
  type ReasoningEffort,
  resolveModelAlias,
  resolvePhaseModelForIssue,
} from '@shipcode/shared';
import type { IpcMainInvokeEvent } from 'electron';

import log from '../logger.service';
import { sendGithubIssuesUpdated } from './helpers';
import type { IpcHandlerDeps } from './types';

export function registerGitHubIssueOverrideHandlers({
  ipcMain,
  mainWindow,
  queries,
}: Pick<IpcHandlerDeps, 'ipcMain' | 'mainWindow' | 'queries'>): void {
  const handleIssueOverride = <TArgs extends unknown[], TResult>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult,
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      try {
        return handler(event, ...(args as TArgs));
      } catch (error) {
        log.error(`[${channel}]`, error);
        throw new Error(clampError(error));
      }
    });
  };

  const VALID_PHASE_ROLES = new Set(['planner', 'reviewer', 'executor', 'verifier'] as const);
  type PhaseRole = 'planner' | 'reviewer' | 'executor' | 'verifier';
  function assertPhaseRole(phase: string): asserts phase is PhaseRole {
    if (!VALID_PHASE_ROLES.has(phase as PhaseRole)) {
      throw new Error(`Invalid phase role: ${phase}`);
    }
  }

  handleIssueOverride(
    'github:set-phase-model-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
        model,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
        model: ExecutorModel;
      },
    ) => {
      assertPhaseRole(phase);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      if (model !== 'claude' && model !== 'codex' && model !== 'openrouter') {
        throw new Error(`Invalid ${phase} model: ${model}`);
      }

      queries.githubIssues.updatePhaseModelOverride(issue.id, phase, model);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  handleIssueOverride(
    'github:clear-phase-model-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
      },
    ) => {
      assertPhaseRole(phase);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);

      queries.githubIssues.updatePhaseModelOverride(issue.id, phase, null);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  handleIssueOverride(
    'github:set-phase-model-id-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
        modelId,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
        modelId: string;
      },
    ) => {
      assertPhaseRole(phase);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const trimmed = modelId.trim();
      if (trimmed && !/^[a-zA-Z0-9._:/@-]+$/.test(trimmed)) {
        throw new Error(`Invalid model ID: ${trimmed}`);
      }
      const provider = resolvePhaseModelForIssue(queries.settings.get(), project, issue, phase);
      queries.githubIssues.updatePhaseModelIdOverride(
        issue.id,
        phase,
        resolveModelAlias(provider, trimmed),
      );
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  handleIssueOverride(
    'github:clear-phase-model-id-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
      },
    ) => {
      assertPhaseRole(phase);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updatePhaseModelIdOverride(issue.id, phase, null);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  handleIssueOverride(
    'github:clear-all-phase-overrides-for-project',
    (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const clearedCount = queries.githubIssues.clearAllPhaseOverridesForProject(projectId);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return { clearedCount };
    },
  );

  handleIssueOverride(
    'github:set-revision-count-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        revisionCount,
      }: {
        projectId: string;
        issueNumber: number;
        revisionCount: import('@shipcode/shared').GitHubIssueCacheRecord['revisionCountOverride'];
      },
    ) => {
      if (
        revisionCount !== null &&
        revisionCount !== 0 &&
        revisionCount !== 1 &&
        revisionCount !== 2 &&
        revisionCount !== 3 &&
        revisionCount !== 4 &&
        revisionCount !== 5
      ) {
        throw new Error(`Invalid revision count override: ${revisionCount}`);
      }
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updateRevisionCountOverride(issue.id, revisionCount);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  handleIssueOverride(
    'github:set-require-approval-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        requireApproval,
      }: {
        projectId: string;
        issueNumber: number;
        requireApproval: import('@shipcode/shared').GitHubIssueCacheRecord['requireApprovalOverride'];
      },
    ) => {
      if (requireApproval !== null && typeof requireApproval !== 'boolean') {
        throw new Error(`Invalid requireApproval override: ${String(requireApproval)}`);
      }
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updateRequireApprovalOverride(issue.id, requireApproval);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  handleIssueOverride(
    'github:set-phase-reasoning-effort-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
        effort,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
        effort: ReasoningEffort;
      },
    ) => {
      assertPhaseRole(phase);
      const VALID_EFFORTS: readonly string[] = [
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
      ];
      if (!VALID_EFFORTS.includes(effort)) {
        throw new Error(`Invalid ${phase} reasoning effort: ${effort}`);
      }
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updatePhaseReasoningEffortOverride(issue.id, phase, effort);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  handleIssueOverride(
    'github:clear-phase-reasoning-effort-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
      },
    ) => {
      assertPhaseRole(phase);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updatePhaseReasoningEffortOverride(issue.id, phase, null);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );
}
