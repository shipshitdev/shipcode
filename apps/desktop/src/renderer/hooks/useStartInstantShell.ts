import {
  type AppSettings,
  getSupportedReasoningEfforts,
  type Project,
  type ReasoningEffort,
  resolveEffectivePhaseReasoningEffort,
  resolvePhaseModel,
  resolvePhaseModelId,
} from '@shipcode/shared';
import { useCallback, useState } from 'react';
import { useAppStore } from '../stores/app-store';

export type InstantShellCli = 'claude' | 'codex';

function shellTitle(cli: InstantShellCli): string {
  return cli === 'claude' ? 'Claude shell' : 'Codex shell';
}

export function useStartInstantShell() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const addInstantPane = useAppStore((state) => state.addInstantPane);
  const openTerminalSessions = useAppStore((state) => state.openTerminalSessions);
  const [startingCli, setStartingCli] = useState<InstantShellCli | null>(null);

  const startInstantShell = useCallback(
    async (cli: InstantShellCli) => {
      if (!activeProjectId) {
        throw new Error('Select a project before starting a shell');
      }

      setStartingCli(cli);
      try {
        const [settings, activeProject] = await Promise.all([
          window.shipcode.invoke<AppSettings>('settings:get'),
          window.shipcode.invoke<Project | null>('project:get', { projectId: activeProjectId }),
        ]);
        const resolvedProvider = resolvePhaseModel(settings, activeProject, 'executor');
        const resolvedModelId =
          resolvedProvider === cli
            ? resolvePhaseModelId(settings, activeProject, 'executor')
            : null;
        const resolvedEffort =
          resolvedProvider === cli
            ? resolveEffectivePhaseReasoningEffort(settings, activeProject, 'executor')
            : 'high';
        const supportedEfforts = getSupportedReasoningEfforts(cli, resolvedModelId);
        const reasoningEffort: ReasoningEffort = supportedEfforts.includes(resolvedEffort)
          ? resolvedEffort
          : (supportedEfforts[supportedEfforts.length - 1] ?? 'high');

        const result = await window.shipcode.invoke<{ threadId: string }>('instant:shell-start', {
          projectId: activeProjectId,
          cli,
          modelId: resolvedModelId,
          reasoningEffort,
        });

        addInstantPane(result.threadId, {
          mode: 'live',
          cli,
          title: shellTitle(cli),
          state: 'running',
        });
        openTerminalSessions();
        return result.threadId;
      } finally {
        setStartingCli((current) => (current === cli ? null : current));
      }
    },
    [activeProjectId, addInstantPane, openTerminalSessions],
  );

  return { startInstantShell, startingCli };
}
