/**
 * ProviderRegistry implementation.
 *
 * Centralizes the (AgentType, ProviderPhase) → AgentProvider dispatch so
 * the pipeline never has to know whether a phase is subprocess-backed
 * (claude/codex CLI) or HTTP-backed (OpenRouter). Phases ask the
 * registry "which provider handles plan for `openrouter`?" and get a
 * concrete provider back.
 *
 * Tier 1 rules:
 * - agent 'claude' → claude-cli provider (all phases)
 * - agent 'codex'  → codex-cli provider (all phases)
 * - agent 'gemini' → gemini-cli provider (all phases)
 * - agent 'openrouter' → openrouter provider (plan/review/revision/verify only)
 * - agent 'gh' is not an LLM agent and is not handled here
 *
 * If a caller asks for a phase the provider does not support (e.g.
 * openrouter + execute in Tier 1), the registry throws immediately so
 * the pipeline fails loud and early rather than silently.
 */

import type { AgentType } from '@shipcode/shared';
import type { AgentProvider, ProviderPhase, ProviderRegistry } from './types';

export interface RegistryProviders {
  claude: AgentProvider;
  codex: AgentProvider;
  gemini?: AgentProvider;
  openrouter: AgentProvider;
}

export function createProviderRegistry(providers: RegistryProviders): ProviderRegistry {
  const byId = new Map<AgentProvider['id'], AgentProvider>([
    [providers.claude.id, providers.claude],
    [providers.codex.id, providers.codex],
    [providers.openrouter.id, providers.openrouter],
  ]);
  if (providers.gemini) byId.set(providers.gemini.id, providers.gemini);

  function forAgent(agent: AgentType): AgentProvider {
    switch (agent) {
      case 'claude':
        return providers.claude;
      case 'codex':
        return providers.codex;
      case 'gemini':
        if (!providers.gemini) {
          throw new Error("ProviderRegistry: provider for agent 'gemini' is not registered");
        }
        return providers.gemini;
      case 'openrouter':
        return providers.openrouter;
      case 'gh':
        throw new Error("ProviderRegistry: 'gh' is not an LLM agent and has no provider");
      case 'shell':
        throw new Error("ProviderRegistry: 'shell' is a bare terminal and has no provider");
    }
  }

  return {
    for(agent: AgentType, phase: ProviderPhase): AgentProvider {
      const provider = forAgent(agent);
      if (!provider.supports.has(phase)) {
        throw new Error(
          `ProviderRegistry: provider '${provider.id}' does not support phase '${phase}' ` +
            `(agent=${agent})`,
        );
      }
      return provider;
    },
    all() {
      return byId;
    },
  };
}
