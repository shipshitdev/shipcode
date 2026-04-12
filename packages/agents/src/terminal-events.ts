/**
 * Canonical terminal event types.
 *
 * All three provider backends (Claude CLI, Codex CLI, OpenRouter)
 * normalize their native output into these events so the terminal
 * drawer renders a single, consistent stream.
 */
export type TerminalEvent =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'tool_start'; name: string; summary: string }
  | { kind: 'tool_end'; name: string; durationMs?: number; exitCode?: number }
  | { kind: 'turn_start'; turn: number }
  | {
      kind: 'turn_end';
      turn: number;
      tokensUsed?: { prompt: number; completion: number };
      costUsd?: number;
    }
  | { kind: 'lifecycle'; message: string }
  | { kind: 'raw'; content: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'done';
      totalTokens?: { prompt: number; completion: number };
      totalCostUsd?: number;
    };
