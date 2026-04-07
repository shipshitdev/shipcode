type ExecutorModel = 'claude' | 'codex'

interface ModelRoute {
  executorModel: ExecutorModel
  command: string
}

const ROUTES: Record<string, ModelRoute> = {
  'agent:claude': { executorModel: 'claude', command: 'claude' },
  'agent:codex': { executorModel: 'codex', command: 'codex' },
}

export function routeFromLabels(labels: string[]): ModelRoute | { error: string } {
  const agentLabels = labels.filter(l => l.startsWith('agent:'))

  if (agentLabels.length > 1) {
    return { error: `Multiple agent labels found: ${agentLabels.join(', ')}` }
  }

  const label = agentLabels[0]
  if (!label || !ROUTES[label]) {
    return ROUTES['agent:claude']
  }

  return ROUTES[label]
}
