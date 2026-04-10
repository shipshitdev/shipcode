import type { ExecutorModel } from '@shipcode/shared';

/**
 * Human-friendly labels for ExecutorModel values. Used wherever the UI
 * surfaces the pipeline's agent choices (Kanban phase labels, IssueDetail
 * agents panel, etc.) so the naming stays consistent.
 */
export const MODEL_DISPLAY: Record<ExecutorModel, string> = {
  claude: 'sonnet 4.6',
  codex: 'gpt 5.4',
  openrouter: 'openrouter',
};

export function modelDisplay(model: ExecutorModel | string): string {
  return MODEL_DISPLAY[model as ExecutorModel] ?? model;
}
