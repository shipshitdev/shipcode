/**
 * Track 1: Agent-SDK / `claude -p` credit-pool exhaustion state.
 *
 * As of 2026-06-15 Anthropic moves `claude -p` (Agent SDK) usage on
 * subscription plans into a separate, capped monthly credit pool (Pro $20,
 * Max5x $100, Max20x $200). When the pool is exhausted, `-p` requests either
 * bill API rates (if usage credits are enabled) or stop entirely until the
 * cycle refreshes. The interactive Claude Code CLI is explicitly unaffected.
 *
 * There is no documented API to poll the remaining pool balance (the
 * interactive `/usage` panel does not surface it), so ShipCode detects
 * exhaustion BY FAILURE: when a `claude -p` invocation fails with a signature
 * matching pool exhaustion we flag it process-wide. While flagged, the pipeline
 * transparently falls back to the interactive CLI and the UI surfaces an alert.
 * The flag auto-expires after a cooldown so a stale flag can never wedge the
 * app, and the user can clear it manually.
 *
 * NOTE: the exact stderr/exit signature Anthropic emits on exhaustion is not
 * yet observable (pre-June-15). `POOL_EXHAUSTION_REGEX` is deliberately broad;
 * tighten it once a real failure is sampled. False positives are low-cost — the
 * fallback target (interactive CLI) works regardless, and the flag self-clears.
 */

/** Broad heuristic matched against a failed claude invocation's output. */
const POOL_EXHAUSTION_REGEX =
  /\b(agent[\s-]?sdk|credit pool|usage limit|out of credits|insufficient credits|quota (?:exceeded|exhausted)|monthly credit|sdk credit)\b/i;

/** Outlives a typical burst, well under a monthly billing cycle. */
const POOL_FLAG_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface PoolExhaustionState {
  exhausted: boolean;
  detectedAt: number | null;
  reason: string | null;
}

export type PoolExhaustionMatcher = (input: {
  stdout: string;
  stderr: string;
  exitCode: number;
}) => boolean;

let state: { detectedAt: number; reason: string } | null = null;

function simulated(): boolean {
  return process.env.SHIPCODE_SIMULATE_POOL_EXHAUSTED === '1';
}

/**
 * Decide whether a failed claude invocation looks like Agent-SDK pool
 * exhaustion. Pure + injectable so tests (and a future tightened matcher)
 * can override the heuristic without touching call sites. Only non-zero
 * exits are ever classified as exhaustion.
 */
export function classifyPoolExhaustion(
  stdout: string,
  stderr: string,
  exitCode: number,
  overrideMatcher?: PoolExhaustionMatcher,
): boolean {
  if (exitCode === 0) return false;
  if (overrideMatcher) return overrideMatcher({ stdout, stderr, exitCode });
  return POOL_EXHAUSTION_REGEX.test(`${stdout}\n${stderr}`);
}

export function markPoolExhausted(reason = 'Agent-SDK credit pool exhausted'): void {
  state = { detectedAt: Date.now(), reason };
}

export function clearPoolExhausted(): void {
  state = null;
}

export function isPoolExhausted(): boolean {
  if (simulated()) return true;
  if (!state) return false;
  if (Date.now() - state.detectedAt > POOL_FLAG_COOLDOWN_MS) {
    state = null;
    return false;
  }
  return true;
}

export function getPoolState(): PoolExhaustionState {
  if (simulated()) {
    return {
      exhausted: true,
      detectedAt: state?.detectedAt ?? Date.now(),
      reason: state?.reason ?? 'Simulated (SHIPCODE_SIMULATE_POOL_EXHAUSTED=1)',
    };
  }
  const exhausted = isPoolExhausted();
  return {
    exhausted,
    detectedAt: exhausted ? (state?.detectedAt ?? null) : null,
    reason: exhausted ? (state?.reason ?? null) : null,
  };
}

/** @knipignore */
export function __resetPoolStateForTests(): void {
  state = null;
}
