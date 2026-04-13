/**
 * Human-friendly labels for executor model keys and resolved model IDs.
 * Used wherever the UI surfaces the pipeline's agent choices (Kanban phase
 * labels, IssueDetail agents panel, etc.) so the naming stays consistent.
 */
export const MODEL_DISPLAY: Record<string, string> = {
  claude: 'sonnet 4.6',
  codex: 'gpt 5.4',
  openrouter: 'openrouter',
  'claude-sonnet-4-6': 'sonnet 4.6',
  'claude-opus-4-6': 'opus 4.6',
  'claude-haiku-4-5-20251001': 'haiku 4.5',
};

export function modelDisplay(model: string): string {
  return MODEL_DISPLAY[model] ?? model;
}
