import {
  RESOLVED_PHASE_MODELS,
  type ResolvedPhaseModel,
  resolvePhaseModel,
  resolvePhaseModelId,
} from './model-resolution';
import type {
  AppSettings,
  CliHealth,
  CliProviderUsageMap,
  CliProviderUsageStatus,
  CliProviderUsageWindow,
  ExecutorModel,
  Project,
} from './types';

export interface ProviderSelectionAssessment {
  severity: 'none' | 'warning' | 'blocked';
  message: string | null;
}

export interface ProjectProviderWarning extends Omit<ProviderSelectionAssessment, 'message'> {
  severity: 'warning' | 'blocked';
  message: string;
  phase: ResolvedPhaseModel;
  phases: ResolvedPhaseModel[];
  provider: Extract<ExecutorModel, 'claude' | 'codex'>;
}

function getWindow(
  status: CliProviderUsageStatus | null | undefined,
  key: CliProviderUsageWindow['key'],
): CliProviderUsageWindow | null {
  return status?.windows.find((window) => window.key === key) ?? null;
}

function isLow(window: CliProviderUsageWindow | null, threshold = 15): boolean {
  return window?.leftPercent != null && window.leftPercent > 0 && window.leftPercent <= threshold;
}

function isExhausted(window: CliProviderUsageWindow | null): boolean {
  return window?.leftPercent != null && window.leftPercent <= 0;
}

function formatLabel(label: string): string {
  return label.trim() || 'quota';
}

function resolveClaudeModelWindow(
  status: CliProviderUsageStatus | null | undefined,
  modelId: string | null,
): CliProviderUsageWindow | null {
  const modelWindow = getWindow(status, 'model');
  if (!modelWindow || !modelId) return modelWindow;

  const modelLower = modelId.toLowerCase();
  const labelLower = modelWindow.label.toLowerCase();
  if (
    (modelLower.includes('opus') && labelLower.includes('opus')) ||
    (modelLower.includes('sonnet') && labelLower.includes('sonnet')) ||
    (modelLower.includes('haiku') && labelLower.includes('haiku'))
  ) {
    return modelWindow;
  }

  return null;
}

export function assessProviderSelection(
  provider: ExecutorModel,
  modelId: string | null,
  cliHealth: CliHealth | null | undefined,
  usage: CliProviderUsageStatus | null | undefined,
): ProviderSelectionAssessment {
  if (provider === 'openrouter') return { severity: 'none', message: null };

  const label = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
  if (!cliHealth?.available) return { severity: 'blocked', message: `${label} not installed` };
  if (!cliHealth.authenticated) {
    return { severity: 'blocked', message: `${label} not authenticated` };
  }
  if (!usage?.available) return { severity: 'none', message: null };

  const session = getWindow(usage, 'session');
  const weekly = getWindow(usage, 'weekly');

  if (isExhausted(session)) {
    return { severity: 'blocked', message: `${label} session exhausted` };
  }

  if (provider === 'codex') {
    if (isExhausted(weekly) && (usage.creditsRemaining ?? 0) <= 0) {
      return { severity: 'blocked', message: `${label} weekly limit exhausted` };
    }
    if (isLow(session)) return { severity: 'warning', message: `${label} session running low` };
    if (isLow(weekly) && (usage.creditsRemaining ?? 0) <= 0) {
      return { severity: 'warning', message: `${label} weekly limit running low` };
    }
    return { severity: 'none', message: null };
  }

  const modelWindow = resolveClaudeModelWindow(usage, modelId);
  if (modelWindow) {
    if (isExhausted(modelWindow)) {
      return {
        severity: 'blocked',
        message: `${label} ${formatLabel(modelWindow.label).toLowerCase()} quota exhausted`,
      };
    }
    if (isLow(modelWindow)) {
      return {
        severity: 'warning',
        message: `${label} ${formatLabel(modelWindow.label).toLowerCase()} quota running low`,
      };
    }
    return { severity: 'none', message: null };
  }

  if (isExhausted(weekly)) {
    return { severity: 'blocked', message: `${label} weekly limit exhausted` };
  }
  if (isLow(session)) return { severity: 'warning', message: `${label} session running low` };
  if (isLow(weekly)) return { severity: 'warning', message: `${label} weekly limit running low` };
  return { severity: 'none', message: null };
}

export function getProjectProviderWarnings(
  settings: AppSettings,
  project: Project,
  system: { claude: CliHealth; codex: CliHealth },
  usage: CliProviderUsageMap | null | undefined,
): ProjectProviderWarning[] {
  const warnings: ProjectProviderWarning[] = [];

  for (const phase of RESOLVED_PHASE_MODELS) {
    const provider = resolvePhaseModel(settings, project, phase);
    if (provider !== 'claude' && provider !== 'codex') continue;

    const modelId = resolvePhaseModelId(settings, project, phase);
    const assessment = assessProviderSelection(
      provider,
      modelId,
      system[provider],
      usage?.[provider],
    );
    if (assessment.severity === 'none' || !assessment.message) continue;

    warnings.push({
      phase,
      phases: [phase],
      provider,
      severity: assessment.severity,
      message: assessment.message,
    });
  }

  const deduped = new Map<string, ProjectProviderWarning>();
  for (const warning of warnings) {
    const key = warning.message;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, warning);
      continue;
    }

    existing.phases = [...new Set([...existing.phases, ...warning.phases])];
  }
  return [...deduped.values()];
}
