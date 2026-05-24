import { formatCost, formatTokenCount, type Thread } from '@shipcode/shared';

type AutomationRunSummary = Pick<
  Thread,
  | 'executorResolvedModel'
  | 'lastError'
  | 'totalCostUsd'
  | 'totalTokensCompletion'
  | 'totalTokensPrompt'
>;

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
