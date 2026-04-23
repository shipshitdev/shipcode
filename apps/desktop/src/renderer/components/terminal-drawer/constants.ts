const EMPTY_STREAM: never[] = [];

export const MIN_HEIGHT = 120;
export const DEFAULT_HEIGHT = 250;

export const CONSOLE_VISIBLE_STATUSES = new Set([
  'clarifying',
  'awaiting_approval',
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
]);

// Map pipeline phase to a readable pending label while output is still empty.
export const PHASE_LABELS: Record<string, string> = {
  planning: 'Thinking',
  clarifying: 'Waiting for clarification',
  reviewing: 'Reviewing',
  revising: 'Thinking',
  awaiting_approval: 'Needs approval',
  executing: 'Working',
  testing: 'Running tests',
  verifying: 'Verifying',
  shipping: 'Shipping',
};

export { EMPTY_STREAM };
