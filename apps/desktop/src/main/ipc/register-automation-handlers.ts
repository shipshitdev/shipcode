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
    // Canonicalize friendly model shorthands (e.g. "opus", "5.5") on save so
    // every downstream consumer sees a concrete model id.
    const normalized: CreateAutomationInput =
      input.executorModelId == null
        ? input
        : { ...input, executorModelId: resolveModelAlias(input.executorModelId) };
    await assertAutomationModelsSupported(
      {
        targets: normalized.targets ?? [normalized.projectId],
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
      const normalized: UpdateAutomationInput =
        patch.executorModelId == null
          ? patch
          : { ...patch, executorModelId: resolveModelAlias(patch.executorModelId) };
      const existing = queries.automations.getById(id);
      if (!existing) throw new Error(`Automation ${id} not found`);
      await assertAutomationModelsSupported(
        {
          targets: normalized.targets ?? existing.targets,
          executorProvider:
            normalized.executorProvider === undefined
              ? existing.executorProvider
              : normalized.executorProvider,
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
