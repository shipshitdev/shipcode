import { formatCost, formatTokenCount, type Thread } from '@shipcode/shared';

type AutomationRunSummary = Pick<
  Thread,
  | 'executorResolvedModel'
  | 'lastError'
  | 'totalCostUsd'
  | 'totalTokensCompletion'
  | 'totalTokensPrompt'
>;

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-agent/10 text-agent border-agent/25',
  completed: 'bg-success/12 text-success border-success/25',
  failed: 'bg-danger/12 text-danger border-danger/25',
};

const STATUS_COLOR_FALLBACK = 'bg-tertiary text-secondary border-border';

/** Badge palette for an automation's last run status, shared by the list and detail views. */
export function automationStatusColor(status: string | null | undefined): string {
  return (status && STATUS_COLOR[status]) || STATUS_COLOR_FALLBACK;
}

export function getAutomationRunTotalTokens(run: AutomationRunSummary): number {
  return (run.totalTokensPrompt ?? 0) + (run.totalTokensCompletion ?? 0);
}

export function describeAutomationRun(
  run: AutomationRunSummary,
  { errorMaxLength = 80 }: { errorMaxLength?: number } = {},
): string {
  if (run.lastError) return run.lastError.slice(0, errorMaxLength);
  const parts: string[] = [];
  const totalTokens = getAutomationRunTotalTokens(run);
  if (run.totalCostUsd > 0) parts.push(formatCost(run.totalCostUsd));
  if (totalTokens > 0) parts.push(`${formatTokenCount(totalTokens)} tokens`);
  if (run.executorResolvedModel) parts.push(run.executorResolvedModel);
  return parts.length > 0 ? parts.join(' · ') : 'No details';
}
