/**
 * Single non-zero exit code for every CLI failure, matching the existing
 * `process.exit(1)` call sites (`issue-number.ts`, `skills.ts`, `onboard.ts`, ...).
 * There is no richer code convention in this CLI — one failure code, uniformly.
 */
export const CLI_FAILURE_EXIT_CODE = 1;

/**
 * Mark the process as failed without tearing it down.
 *
 * Use this for failure paths that print a message and then `return`. Assigning
 * `process.exitCode` (instead of calling `process.exit()`) lets the command
 * unwind normally and lets stdout/stderr flush before Node exits, which matters
 * because several commands stream output. Without it those paths exit 0 and
 * `shipcode run 123 && deploy` runs `deploy` after a failed run.
 *
 * Hard failures that must abort mid-function keep using `process.exit(1)` — its
 * `never` return type is what narrows the types after the guard.
 */
export function markCliFailure(): void {
  process.exitCode = CLI_FAILURE_EXIT_CODE;
}
