import { type ExecutorModel, isAgentRoutingLabel } from '@shipcode/shared';

export interface ModelRoute {
  executorModel: ExecutorModel;
  command: string;
  /**
   * Optional explicit model override propagated to the OpenRouter
   * provider when the agent is 'openrouter'. For claude/codex this is
   * unused. Populated when the GitHub label encodes a specific model
   * slug (e.g. 'shipcode:agent:openrouter/auto' → modelOverride='openrouter/auto').
   */
  modelOverride?: string;
}

const ROUTES: Record<string, ModelRoute> = {
  'shipcode:agent:claude': { executorModel: 'claude', command: 'claude' },
  'shipcode:agent:codex': { executorModel: 'codex', command: 'codex' },
  'shipcode:agent:openrouter': { executorModel: 'openrouter', command: 'openrouter' },
  'shipcode:agent:openrouter/auto': {
    executorModel: 'openrouter',
    command: 'openrouter',
    modelOverride: 'openrouter/auto',
  },
  'shipcode:agent:openrouter/free': {
    executorModel: 'openrouter',
    command: 'openrouter',
    modelOverride: 'openrouter/free',
  },
};

export function routeFromLabels(labels: string[]): ModelRoute | { error: string } {
  const agentLabels = labels.filter(isAgentRoutingLabel);

  const uniqueAgentLabels = Array.from(new Set(agentLabels));
  if (uniqueAgentLabels.length > 1) {
    return { error: `Multiple agent labels found: ${agentLabels.join(', ')}` };
  }

  const normalizedLabel = uniqueAgentLabels[0] ?? null;
  if (!normalizedLabel || !ROUTES[normalizedLabel]) {
    return ROUTES['shipcode:agent:claude'];
  }

  return ROUTES[normalizedLabel];
}
