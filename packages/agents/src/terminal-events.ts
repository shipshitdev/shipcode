import type { CanonicalTerminalEvent } from '@shipcode/shared';

/**
 * Canonical terminal event types.
 *
 * All three provider backends (Claude CLI, Codex CLI, OpenRouter)
 * normalize their native output into these events so the terminal
 * drawer renders a single, consistent stream.
 */
export type TerminalEvent = CanonicalTerminalEvent;
