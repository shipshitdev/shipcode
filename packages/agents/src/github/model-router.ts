import type { AgentType } from '@shipcode/shared';

// Narrow to the agent types that can actually execute a pipeline run.
// 'gh' is excluded because it's a data-plane CLI, not an executor.
export type ExecutorModel = Exclude<AgentType, 'gh'>;

export interface ModelRoute {
  executorModel: ExecutorModel;
  command: string;
  /**
   * Optional explicit model override propagated to the OpenRouter
   * provider when the agent is 'openrouter'. For claude/codex this is
   * unused. Populated when the GitHub label encodes a specific model
   * slug (e.g. 'agent:openrouter/auto' → modelOverride='openrouter/auto').
   */
  modelOverride?: string;
}

const ROUTES: Record<string, ModelRoute> = {
  'agent:claude': { executorModel: 'claude', command: 'claude' },
  'agent:codex': { executorModel: 'codex', command: 'codex' },
  'agent:openrouter': { executorModel: 'openrouter', command: 'openrouter' },
  'agent:openrouter/auto': {
    executorModel: 'openrouter',
    command: 'openrouter',
    modelOverride: 'openrouter/auto',
  },
  'agent:openrouter/free': {
    executorModel: 'openrouter',
    command: 'openrouter',
    modelOverride: 'openrouter/free',
  },
};

export function routeFromLabels(labels: string[]): ModelRoute | { error: string } {
  const agentLabels = labels.filter((l) => l.startsWith('agent:'));

  if (agentLabels.length > 1) {
    return { error: `Multiple agent labels found: ${agentLabels.join(', ')}` };
  }

  const label = agentLabels[0];
  if (!label || !ROUTES[label]) {
    return ROUTES['agent:claude'];
  }

  return ROUTES[label];
}
