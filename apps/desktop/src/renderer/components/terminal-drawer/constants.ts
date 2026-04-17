const EMPTY_STREAM: never[] = [];

export const MIN_HEIGHT = 120;
export const DEFAULT_HEIGHT = 250;

export const AGENT_ACTIVE_STATUSES = new Set([
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
]);

// Braille spinner frames for animated status indicator
export const SPINNER_FRAMES = [
  '\u280B',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283C',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280F',
];
export const SPINNER_INTERVAL_MS = 200;

// Map pipeline phase to a human-readable label for the spinner
export const PHASE_LABELS: Record<string, string> = {
  planning: 'Thinking',
  reviewing: 'Reviewing',
  revising: 'Thinking',
  executing: 'Working',
  testing: 'Running tests',
  verifying: 'Verifying',
  shipping: 'Shipping',
};

// Event kind groups for inserting blank lines at group boundaries in the terminal.
export const LIFECYCLE_KINDS = new Set(['lifecycle']);
export const CONTENT_KINDS = new Set(['text', 'thinking', 'raw']);

export { EMPTY_STREAM };
