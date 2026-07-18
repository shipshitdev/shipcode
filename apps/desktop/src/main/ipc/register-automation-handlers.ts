import {
  type AgentType,
  type Automation,
  type CreateAutomationInput,
  clampError,
  type ExecutorModel,
  resolveModelAlias,
  type UpdateAutomationInput,
} from '@shipcode/shared';
import { Cron } from 'croner';
import type { IpcMainInvokeEvent } from 'electron';
import type { AutomationSchedulerLike } from '../automation-scheduler';
import log from '../logger.service';
import { assertCliPhaseModelsSupported, resolveProjectPhaseModels } from './helpers';
import type { IpcHandlerDeps } from './types';

function validateCron(expr: string): void {
  // `paused: true` makes croner validate the expression without scheduling it.
  // Throws on invalid input — caller wraps in try/catch + clampError.
  new Cron(expr, { paused: true });
}

type AutomationModelSelection = {
  targets: string[];
  executorProvider: AgentType | null;
  executorModelId: string | null;
  executorReasoningEffort: Automation['executorReasoningEffort'];
};

function normalizeAutomationExecutorModelId(
  selection: Pick<AutomationModelSelection, 'targets' | 'executorProvider' | 'executorModelId'>,
  queries: IpcHandlerDeps['queries'],
): string | null {
  const modelId = selection.executorModelId;
  if (modelId == null) return null;
  const settings = queries.settings.get();
  const normalizedValues = new Set(
    selection.targets.map((projectId) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Automation target project ${projectId} not found`);
      const fallback = resolveProjectPhaseModels(settings, project).executorModel;
      const provider = resolveAutomationExecutorProvider(selection.executorProvider, fallback);
      return resolveModelAlias(provider, modelId);
    }),
  );
  if (normalizedValues.size !== 1) {
    throw new Error('Automation model ID resolves differently across its target providers');
  }
  return [...normalizedValues][0] ?? null;
}

function resolveAutomationExecutorProvider(
  provider: AgentType | null,
  fallback: ExecutorModel,
): ExecutorModel {
  if (provider === null) return fallback;
  switch (provider) {
    case 'claude':
    case 'codex':
    case 'gemini':
    case 'cursor':
    case 'grok':
    case 'openrouter':
      return provider;
    case 'gh':
    case 'shell':
      throw new Error(`${provider} cannot be used as an automation executor`);
  }
}

async function assertAutomationModelsSupported(
  selection: AutomationModelSelection,
  queries: IpcHandlerDeps['queries'],
): Promise<void> {
  const settings = queries.settings.get();

  for (const projectId of selection.targets) {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Automation target project ${projectId} not found`);

    const phaseModels = resolveProjectPhaseModels(settings, project);
    await assertCliPhaseModelsSupported({
      ...phaseModels,
      executorModel: resolveAutomationExecutorProvider(
        selection.executorProvider,
        phaseModels.executorModel,
      ),
      executorModelId: selection.executorModelId ?? phaseModels.executorModelId,
      executorReasoningEffort:
        selection.executorReasoningEffort ?? phaseModels.executorReasoningEffort,
    });
  }
}

export function registerAutomationHandlers(
  { ipcMain, queries }: IpcHandlerDeps,
  automationScheduler: AutomationSchedulerLike,
): void {
  const handleAutomation = <TArgs extends unknown[], TResult>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...(args as TArgs));
      } catch (err) {
        log.error(`[${channel}]`, err);
        throw new Error(clampError(err));
      }
    });
  };

  handleAutomation('automations:list-all', async () => {
    return queries.automations.listAll();
  });

  handleAutomation('automations:list', async (_e, { projectId }: { projectId: string }) => {
    return queries.automations.list(projectId);
  });

  handleAutomation('automations:get', async (_e, { id }: { id: string }) => {
    return queries.automations.getById(id);
  });

  handleAutomation('automations:create', async (_e, input: CreateAutomationInput) => {
    validateCron(input.cronExpr);
    const targets = input.targets ?? [input.projectId];
    const normalized: CreateAutomationInput = {
      ...input,
      executorModelId: normalizeAutomationExecutorModelId(
        {
          targets,
          executorProvider: input.executorProvider ?? null,
          executorModelId: input.executorModelId ?? null,
        },
        queries,
      ),
    };
    await assertAutomationModelsSupported(
      {
        targets,
        executorProvider: normalized.executorProvider ?? null,
        executorModelId: normalized.executorModelId ?? null,
        executorReasoningEffort: normalized.executorReasoningEffort ?? null,
      },
      queries,
    );
    const automation = queries.automations.create(normalized);
    automationScheduler.schedule(automation);
    return automation;
  });

  handleAutomation(
    'automations:update',
    async (_e, payload: { id: string } & UpdateAutomationInput) => {
      const { id, ...patch } = payload;
      if (patch.cronExpr !== undefined) validateCron(patch.cronExpr);
      const existing = queries.automations.getById(id);
      if (!existing) throw new Error(`Automation ${id} not found`);
      const targets = patch.targets ?? existing.targets;
      const executorProvider =
        patch.executorProvider === undefined ? existing.executorProvider : patch.executorProvider;
      const executorModelId =
        patch.executorModelId === undefined ? existing.executorModelId : patch.executorModelId;
      const normalized: UpdateAutomationInput = {
        ...patch,
        ...(patch.executorModelId !== undefined || patch.executorProvider !== undefined
          ? {
              executorModelId: normalizeAutomationExecutorModelId(
                {
                  targets,
                  executorProvider,
                  executorModelId,
                },
                queries,
              ),
            }
          : {}),
      };
      await assertAutomationModelsSupported(
        {
          targets,
          executorProvider,
          executorModelId:
            normalized.executorModelId === undefined
              ? existing.executorModelId
              : normalized.executorModelId,
          executorReasoningEffort:
            normalized.executorReasoningEffort === undefined
              ? existing.executorReasoningEffort
              : normalized.executorReasoningEffort,
        },
        queries,
      );
      const automation = queries.automations.update(id, normalized);
      automationScheduler.schedule(automation);
      return automation;
    },
  );

  handleAutomation('automations:delete', async (_e, { id }: { id: string }) => {
    automationScheduler.unschedule(id);
    queries.automations.delete(id);
    return undefined;
  });

  handleAutomation(
    'automations:set-enabled',
    async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
      if (enabled) {
        const existing = queries.automations.getById(id);
        if (!existing) throw new Error(`Automation ${id} not found`);
        await assertAutomationModelsSupported(
          {
            targets: existing.targets,
            executorProvider: existing.executorProvider,
            executorModelId: existing.executorModelId,
            executorReasoningEffort: existing.executorReasoningEffort,
          },
          queries,
        );
      }
      const automation = queries.automations.setEnabled(id, enabled);
      if (enabled) {
        automationScheduler.schedule(automation);
      } else {
        automationScheduler.unschedule(id);
        queries.automations.setNextRunAt(id, null);
      }
      return automation;
    },
  );

  handleAutomation('automations:run-now', async (_e, { id }: { id: string }) => {
    const automation = queries.automations.getById(id);
    if (!automation) throw new Error(`Automation ${id} not found`);
    // fireNow routes through pipelineScheduler so capacity caps still apply.
    // We deliberately don't await the full pipeline run — only the
    // start-or-queue decision — so the IPC call returns promptly.
    return automationScheduler.fireNow(id);
  });

  handleAutomation(
    'automations:run-history',
    async (_e, { automationId }: { automationId: string }) => {
      return queries.threads.listByAutomationId(automationId);
    },
  );
}
