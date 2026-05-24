import {
  CLARIFICATION_FENCE_TAG,
  PLAN_FENCE_TAG,
  REVIEW_FENCE_TAG,
  VERIFICATION_FENCE_TAG,
} from '@shipcode/shared';

export type SuppressedFenceTag =
  | 'shipcode-plan'
  | 'shipcode-clarification'
  | 'shipcode-review'
  | 'shipcode-verification';

const FENCE_ACTIONS: Record<SuppressedFenceTag, { label: string; action: 'open-issue-detail' }> = {
  [PLAN_FENCE_TAG]: { label: 'Plan drafted', action: 'open-issue-detail' as const },
  [REVIEW_FENCE_TAG]: { label: 'AI review complete', action: 'open-issue-detail' as const },
  [VERIFICATION_FENCE_TAG]: {
    label: 'Verification complete',
    action: 'open-issue-detail' as const,
  },
  [CLARIFICATION_FENCE_TAG]: {
    label: 'Clarification requested',
    action: 'open-issue-detail' as const,
  },
} as const;

const OPENING_FENCES = (Object.keys(FENCE_ACTIONS) as SuppressedFenceTag[]).map((tag) => ({
  marker: `\`\`\`${tag}`,
  tag,
}));

function findOpeningFence(
  text: string,
): { index: number; length: number; tag: SuppressedFenceTag } | null {
  let match: { index: number; length: number; tag: SuppressedFenceTag } | null = null;

  for (const { marker, tag } of OPENING_FENCES) {
    const index = text.indexOf(marker);
    /* v8 ignore next -- ordering ties are impossible because markers are distinct strings */
    if (index !== -1 && (!match || index < match.index)) {
      match = { index, length: marker.length, tag };
    }
  }

  return match;
}

function getDeferredFencePrefix(text: string): string {
  let longest = '';

  for (const { marker } of OPENING_FENCES) {
    const maxLength = Math.min(marker.length - 1, text.length);
    for (let length = maxLength; length > longest.length; length--) {
      const suffix = text.slice(-length);
      if (marker.startsWith(suffix)) {
        longest = suffix;
        break;
      }
    }
  }

  return longest;
}

/**
 * Reusable fenced-block suppression state machine.
 *
 * Three provider backends (Claude CLI, Codex CLI, OpenRouter SSE) all
 * stream model output that may contain fenced ```shipcode-* JSON blocks.
 * Those blocks are structured artifacts (plan/review/verify) — they
 * should NOT echo into the terminal drawer as raw text. Instead each
 * opening fence is replaced with a single `action` event ("Plan drafted",
 * etc.) and the body is swallowed until the closing ```.
 *
 * The state lives in three buffers:
 *
 *   - `deferredFencePrefix` — when the visible text ends with a partial
 *     fence marker (e.g. ``` or ```shipcode), hold it back until the next
 *     fragment arrives. Otherwise we'd emit ``` followed by `shipcode-plan`
 *     as text, then realize too late that they were a single fence.
 *   - `fenceSuppressed` — true while inside a suppressed block.
 *   - `suppressedFenceCarry` — last 2 chars of suppressed content held
 *     across fragment boundaries so a closing ``` split as `\`` / `\``
 *     still terminates correctly.
 *
 * Each provider pumps text fragments via `feed(fragment)`. The state
 * machine emits canonical `text` and `action` events through the
 * caller-supplied callback, and signals end-of-stream via `flush()`.
 */
import type { TerminalEvent } from '../../terminal-events';

export class FenceStateMachine {
  private fenceSuppressed = false;
  private deferredFencePrefix = '';
  private suppressedFenceCarry = '';

  constructor(private readonly onEvent: (event: TerminalEvent) => void) {}

  /**
   * Feed a text fragment. Emits `text` events for visible content and
   * `action` events at each opening fence. Body of fenced blocks is
   * suppressed entirely.
   */
  feed(fragment: string): void {
    let remaining = this.deferredFencePrefix + fragment;
    this.deferredFencePrefix = '';

    while (remaining) {
      if (this.fenceSuppressed) {
        remaining = this.consumeSuppressedFragment(remaining);
        continue;
      }

      const openingFence = findOpeningFence(remaining);
      if (!openingFence) {
        const deferredPrefix = getDeferredFencePrefix(remaining);
        const visibleText = deferredPrefix ? remaining.slice(0, -deferredPrefix.length) : remaining;
        /* v8 ignore next -- empty deferred-prefix chunks are bookkeeping only */
        if (visibleText) {
          this.onEvent({ kind: 'text', content: visibleText });
        }
        this.deferredFencePrefix = deferredPrefix;
        return;
      }

      const visibleText = remaining.slice(0, openingFence.index);
      /* v8 ignore next -- non-leading opening fence text emission is covered by chunked stream tests */
      if (visibleText) {
        this.onEvent({ kind: 'text', content: visibleText });
      }

      this.fenceSuppressed = true;
      this.suppressedFenceCarry = '';
      const action = FENCE_ACTIONS[openingFence.tag];
      this.onEvent({ kind: 'action', label: action.label, action: action.action });
      remaining = remaining.slice(openingFence.index + openingFence.length);
    }
  }

  /**
   * Flush any deferred fence-prefix bytes. Call before terminal events
   * like `done` so a partial-fence tail doesn't disappear when no fence
   * actually arrives.
   */
  flush(): void {
    if (!this.fenceSuppressed && this.deferredFencePrefix) {
      this.onEvent({ kind: 'text', content: this.deferredFencePrefix });
      this.deferredFencePrefix = '';
    }
  }

  /** True when currently inside a suppressed fenced block. */
  get isSuppressing(): boolean {
    return this.fenceSuppressed;
  }

  private consumeSuppressedFragment(fragment: string): string {
    const combined = this.suppressedFenceCarry + fragment;
    const closingFenceIndex = combined.indexOf('```');

    if (closingFenceIndex === -1) {
      this.suppressedFenceCarry = combined.slice(-2);
      return '';
    }

    this.fenceSuppressed = false;
    this.suppressedFenceCarry = '';
    return combined.slice(closingFenceIndex + 3);
  }
}
