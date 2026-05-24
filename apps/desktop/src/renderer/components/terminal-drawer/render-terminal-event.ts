import type { TerminalEvent } from '@shipcode/agents';
import { ERROR_PATTERNS } from '@shipcode/shared';

/**
 * Render a canonical TerminalEvent into an ANSI-formatted string for xterm.
 */
export function renderTerminalEvent(event: TerminalEvent): string | null {
  switch (event.kind) {
    case 'action':
      return null;
    case 'text': {
      const lines = event.content.split('\n');
      return lines.map((line) => `\x1b[36m\u2502\x1b[0m ${line}`).join('\n');
    }
    case 'thinking': {
      const lines = event.content.split('\n');
      return lines.map((line) => `\x1b[2;35m\u2502\x1b[0m \x1b[2;3m${line}\x1b[0m`).join('\n');
    }
    case 'tool_start':
      return `\x1b[2m\u2192 ${event.summary}\x1b[0m`;
    case 'tool_end':
      if (event.exitCode !== undefined && event.exitCode !== 0) {
        return event.outputSummary
          ? `\x1b[31m[exit ${event.exitCode}]\n${event.outputSummary}\x1b[0m`
          : `\x1b[31m[exit ${event.exitCode}]\x1b[0m`;
      }
      if (event.durationMs !== undefined) {
        return `\x1b[2m(${(event.durationMs / 1000).toFixed(1)}s)\x1b[0m`;
      }
      return null;
    case 'turn_start':
      return `\x1b[2m\u2500\u2500 Turn ${event.turn} \u2500\u2500\x1b[0m`;
    case 'turn_end': {
      const parts: string[] = [];
      if (event.tokensUsed) {
        parts.push(`${event.tokensUsed.prompt}+${event.tokensUsed.completion} tok`);
      }
      if (event.costUsd && event.costUsd > 0) {
        parts.push(`$${event.costUsd.toFixed(4)}`);
      }
      return parts.length > 0 ? `\x1b[2m${parts.join(' \u00b7 ')}\x1b[0m` : null;
    }
    case 'lifecycle':
      return event.message;
    case 'raw': {
      const isRateLimited = ERROR_PATTERNS.some(
        ({ pattern, type }) => type === 'rate_limited' && pattern.test(event.content),
      );
      return isRateLimited ? `\x1b[31m${event.content}\x1b[0m` : event.content;
    }
    case 'error':
      return `\x1b[31m${event.message}\x1b[0m`;
    case 'done': {
      const parts: string[] = [];
      if (event.totalTokens) {
        parts.push(`${event.totalTokens.prompt}+${event.totalTokens.completion} tok`);
      }
      if (event.totalCostUsd && event.totalCostUsd > 0) {
        parts.push(`~$${event.totalCostUsd.toFixed(4)}`);
      }
      return parts.length > 0 ? `\x1b[2m[done: ${parts.join(' \u00b7 ')}]\x1b[0m` : null;
    }
    default:
      return null;
  }
}
