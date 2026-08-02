import {
  clampError,
  type ExecutorModel,
  type GitHubIssueCacheRecord,
  getPhaseDescriptor,
  type ReasoningEffort,
  resolveModelAlias,
  resolvePhaseModelForIssue,
} from '@shipcode/shared';
import type { IpcMainInvokeEvent } from 'electron';

import log from '../logger.service';
import { sendGithubIssuesUpdated } from './helpers';
import { requireProject } from './lookups';
import type { IpcHandlerDeps } from './types';

type IssueOverrideArgs = {
  projectId: string;
  issueNumber: number;
};

type PhaseRole = 'planner' | 'reviewer' | 'executor' | 'verifier';

type PhaseOverrideArgs = IssueOverrideArgs & {
  phase: PhaseRole;
};

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
  function assertPhaseRole(phase: string): asserts phase is PhaseRole {
    if (!VALID_PHASE_ROLES.has(phase as PhaseRole)) {
      throw new Error(`Invalid phase role: ${phase}`);
    }
  }

  const defineIssueOverrideHandler = <TArgs extends IssueOverrideArgs>(
    channel: string,
    mutate: (issue: GitHubIssueCacheRecord, args: TArgs) => void,
    validate?: (args: TArgs) => void,
  ): void => {
    handleIssueOverride(channel, (_event, args: TArgs) => {
      validate?.(args);
      const issue = queries.githubIssues.getByNumber(args.projectId, args.issueNumber);
      if (!issue) throw new Error(`Issue #${args.issueNumber} not found in cache`);

      mutate(issue, args);
      sendGithubIssuesUpdated(mainWindow, queries, args.projectId);
      return queries.githubIssues.getByNumber(args.projectId, args.issueNumber);
    });
  };

  defineIssueOverrideHandler<
    PhaseOverrideArgs & {
      model: ExecutorModel;
    }
  >(
    'github:set-phase-model-override',
    (issue, { phase, model }) => {
      if (model !== 'claude' && model !== 'codex' && model !== 'openrouter') {
        throw new Error(`Invalid ${phase} model: ${model}`);
      }
      const descriptor = getPhaseDescriptor(phase);
      const existingModelId = issue[descriptor.issueModelIdOverrideKey];
      if (existingModelId) {
        resolveModelAlias(model, existingModelId);
      }

      queries.githubIssues.updatePhaseModelOverride(issue.id, phase, model);
    },
    ({ phase }) => assertPhaseRole(phase),
  );

  defineIssueOverrideHandler<PhaseOverrideArgs>(
    'github:clear-phase-model-override',
    (issue, { phase }) => {
      queries.githubIssues.updatePhaseModelOverride(issue.id, phase, null);
    },
    ({ phase }) => assertPhaseRole(phase),
  );

  defineIssueOverrideHandler<
    PhaseOverrideArgs & {
      modelId: string;
    }
  >(
    'github:set-phase-model-id-override',
    (issue, { projectId, phase, modelId }) => {
      const trimmed = modelId.trim();
      if (trimmed && !/^[a-zA-Z0-9._:/@-]+$/.test(trimmed)) {
        throw new Error(`Invalid model ID: ${trimmed}`);
      }
      const project = requireProject(queries, projectId);
      const provider = resolvePhaseModelForIssue(queries.settings.get(), project, issue, phase);
      queries.githubIssues.updatePhaseModelIdOverride(
        issue.id,
        phase,
        resolveModelAlias(provider, trimmed),
      );
    },
    ({ phase }) => assertPhaseRole(phase),
  );

  defineIssueOverrideHandler<PhaseOverrideArgs>(
    'github:clear-phase-model-id-override',
    (issue, { phase }) => {
      queries.githubIssues.updatePhaseModelIdOverride(issue.id, phase, null);
    },
    ({ phase }) => assertPhaseRole(phase),
  );

  handleIssueOverride(
    'github:clear-all-phase-overrides-for-project',
    (_event, { projectId }: { projectId: string }) => {
      requireProject(queries, projectId);

      const clearedCount = queries.githubIssues.clearAllPhaseOverridesForProject(projectId);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return { clearedCount };
    },
  );

  defineIssueOverrideHandler<
    IssueOverrideArgs & {
      revisionCount: GitHubIssueCacheRecord['revisionCountOverride'];
    }
  >(
    'github:set-revision-count-override',
    (issue, { revisionCount }) => {
      queries.githubIssues.updateRevisionCountOverride(issue.id, revisionCount);
    },
    ({ revisionCount }) => {
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
    },
  );

  defineIssueOverrideHandler<
    IssueOverrideArgs & {
      requireApproval: GitHubIssueCacheRecord['requireApprovalOverride'];
    }
  >(
    'github:set-require-approval-override',
    (issue, { requireApproval }) => {
      queries.githubIssues.updateRequireApprovalOverride(issue.id, requireApproval);
    },
    ({ requireApproval }) => {
      if (requireApproval !== null && typeof requireApproval !== 'boolean') {
        throw new Error(`Invalid requireApproval override: ${String(requireApproval)}`);
      }
    },
  );

  defineIssueOverrideHandler<
    PhaseOverrideArgs & {
      effort: ReasoningEffort;
    }
  >(
    'github:set-phase-reasoning-effort-override',
    (issue, { phase, effort }) => {
      queries.githubIssues.updatePhaseReasoningEffortOverride(issue.id, phase, effort);
    },
    ({ phase, effort }) => {
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
    },
  );

  defineIssueOverrideHandler<PhaseOverrideArgs>(
    'github:clear-phase-reasoning-effort-override',
    (issue, { phase }) => {
      queries.githubIssues.updatePhaseReasoningEffortOverride(issue.id, phase, null);
    },
    ({ phase }) => assertPhaseRole(phase),
  );
}
