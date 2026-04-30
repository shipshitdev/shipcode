export const PROMPT_TEMPLATE_SHELL_MARKER = '\x01';

const SHELL_BLOCK_PATTERN = /!`([^`]+)`/g;
const DEFAULT_PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export type PromptTemplateArgValue = string | number | boolean;

export class PromptTemplateError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing_arg',
  ) {
    super(message);
    this.name = 'PromptTemplateError';
  }
}

export interface SubstitutePromptTemplateArgsOptions {
  /**
   * Custom placeholder matcher. Must expose the placeholder key as capture
   * group 1. Defaults to `{{KEY}}` with optional inner whitespace.
   */
  placeholderPattern?: RegExp;
  /**
   * Return a replacement for missing placeholders. If omitted, missing values
   * throw PromptTemplateError.
   */
  missingValue?: (key: string, providedKeys: string[]) => string;
  /**
   * Keep markers on template-authored shell blocks for a downstream prompt
   * shell preprocessor. Defaults to false because most ShipCode prompts are
   * sent directly to providers.
   */
  preserveShellBlockMarkers?: boolean;
}

export interface SubstitutePromptTemplateArgsResult {
  text: string;
  referencedKeys: string[];
  unusedKeys: string[];
}

export function markPromptTemplateShellBlocks(template: string): string {
  return template
    .replaceAll(PROMPT_TEMPLATE_SHELL_MARKER, '')
    .replace(SHELL_BLOCK_PATTERN, `!${PROMPT_TEMPLATE_SHELL_MARKER}\`$1\``);
}

export function stripPromptTemplateShellMarkers(text: string): string {
  return text.replaceAll(PROMPT_TEMPLATE_SHELL_MARKER, '');
}

export function sanitizePromptTemplateValue(value: PromptTemplateArgValue): string {
  return String(value).replaceAll(PROMPT_TEMPLATE_SHELL_MARKER, '');
}

export function substitutePromptTemplateArgs(
  template: string,
  args: Record<string, PromptTemplateArgValue>,
  options: SubstitutePromptTemplateArgsOptions = {},
): SubstitutePromptTemplateArgsResult {
  const placeholderPattern = cloneGlobalPattern(
    options.placeholderPattern ?? DEFAULT_PLACEHOLDER_PATTERN,
  );
  const markedTemplate = markPromptTemplateShellBlocks(template);
  const sanitizedArgs = new Map<string, string>();
  for (const [key, value] of Object.entries(args)) {
    sanitizedArgs.set(key, sanitizePromptTemplateValue(value));
  }

  const referencedKeys = new Set<string>();
  const providedKeys = [...sanitizedArgs.keys()];

  const textWithMarkers = markedTemplate.replace(placeholderPattern, (_match, key: string) => {
    referencedKeys.add(key);
    const value = sanitizedArgs.get(key);
    if (value !== undefined) return value;
    if (options.missingValue) return options.missingValue(key, providedKeys);
    throw new PromptTemplateError(
      `Prompt argument "{{${key}}}" has no matching value (provided: ${providedKeys.join(', ') || 'none'})`,
      'missing_arg',
    );
  });

  const unusedKeys = providedKeys.filter((key) => !referencedKeys.has(key));
  const text = options.preserveShellBlockMarkers
    ? textWithMarkers
    : stripPromptTemplateShellMarkers(textWithMarkers);

  return {
    text,
    referencedKeys: [...referencedKeys],
    unusedKeys,
  };
}

function cloneGlobalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}
