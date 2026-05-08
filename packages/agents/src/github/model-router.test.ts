import { describe, expect, it } from 'vitest';
import { routeFromLabels } from './model-router';

describe('routeFromLabels', () => {
  it('routes namespaced ShipCode agent labels', () => {
    expect(routeFromLabels(['shipcode:agent:codex'])).toEqual({
      executorModel: 'codex',
      command: 'codex',
    });
    expect(routeFromLabels(['shipcode:agent:openrouter/auto'])).toEqual({
      executorModel: 'openrouter',
      command: 'openrouter',
      modelOverride: 'openrouter/auto',
    });
  });

  it('routes legacy agent labels for existing issues', () => {
    expect(routeFromLabels(['agent:codex'])).toEqual({
      executorModel: 'codex',
      command: 'codex',
    });
    expect(routeFromLabels(['agent:openrouter/free'])).toEqual({
      executorModel: 'openrouter',
      command: 'openrouter',
      modelOverride: 'openrouter/free',
    });
  });

  it('deduplicates equivalent legacy and namespaced labels', () => {
    expect(routeFromLabels(['agent:codex', 'shipcode:agent:codex'])).toEqual({
      executorModel: 'codex',
      command: 'codex',
    });
  });

  it('falls back to namespaced Claude route when no route label exists', () => {
    expect(routeFromLabels(['enhancement'])).toEqual({
      executorModel: 'claude',
      command: 'claude',
    });
  });

  it('rejects multiple namespaced agent labels', () => {
    expect(routeFromLabels(['shipcode:agent:codex', 'shipcode:agent:claude'])).toEqual({
      error: 'Multiple agent labels found: shipcode:agent:codex, shipcode:agent:claude',
    });
  });
});
