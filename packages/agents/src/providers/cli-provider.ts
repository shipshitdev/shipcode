/**
 * CLI providers wrapping the existing claude/codex subprocess path.
 *
 * These are BEHAVIOR-PRESERVING: the arg lists constructed here must
 * match the inline spawn calls that previously lived in
 * `packages/pipeline/src/pipeline.ts` byte-for-byte. The snapshot-based
 * regression tests in `cli-provider.test.ts` enforce this.
 *
 * The only meaningful change is lifecycle: instead of the pipeline
 * attaching `output`/`exit` listeners to the shared ProcessManager and
 * continuing execution from within the exit handler, the provider wraps
 * the spawn → accumulate → wait → cleanup flow in a single promise. The
 * pipeline awaits that promise and then keeps its existing phase-specific
 * completion logic (salvage-on-non-zero for PLAN, ignore-exit for
 * REVIEW/REVISION/VERIFY, exit-zero-only for EXECUTE).
 */

import type { ProcessManager } from '../process-manager';
import { StreamParser } from '../stream-parser';
import { mapReasoningEffortToClaudeThinkingTokens, mapReasoningEffortToCodex } from './reasoning';
import type { AgentProvider, ProviderPhase, ProviderRequest, ProviderResponse } from './types';

interface CliRunResult {
  rawOutput: string;
  exitCode: number;
}

/**
 * Spawn a CLI via ProcessManager, accumulate output, wait for exit,
 * honoring the abort signal. Shared by both Claude and Codex providers.
 */
async function runCli(
  processManager: ProcessManager,
  agentId: 'claude' | 'codex',
  args: string[],
  cwd: string,
  signal: AbortSignal,
  threadId?: string,
): Promise<CliRunResult> {
  if (signal.aborted) {
    return { rawOutput: '', exitCode: 130 };
  }

  let process: ReturnType<ProcessManager['spawn']>;
  try {
    process = processManager.spawn(agentId, agentId, args, cwd, threadId);
  } catch (err) {
    // ProcessManager synthesizes an exit event for missing binaries etc.
    // but if spawn() throws synchronously, surface that as exit 127.
    return {
      rawOutput: err instanceof Error ? err.message : String(err),
      exitCode: 127,
    };
  }

  return new Promise<CliRunResult>((resolve) => {
    let rawOutput = '';
    let settled = false;

    const cleanup = () => {
      processManager.removeListener('output', outputHandler);
      processManager.removeListener('exit', exitHandler);
      signal.removeEventListener('abort', abortHandler);
    };

    const settle = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) rawOutput += data;
    };

    const exitHandler = (processId: string, exitCode: number) => {
      if (processId !== process.id) return;
      settle({ rawOutput, exitCode });
    };

    const abortHandler = () => {
      try {
        processManager.kill(process.id);
      } catch {
        // kill may fail if process already exited; exit handler will settle.
      }
      // Don't settle here — let the subsequent exit event carry the exitCode.
      // If no exit fires within a short grace window, force-settle with 130.
      setTimeout(() => {
        if (!settled) settle({ rawOutput, exitCode: 130 });
      }, 2000);
    };

    processManager.on('output', outputHandler);
    processManager.on('exit', exitHandler);
    signal.addEventListener('abort', abortHandler, { once: true });
  });
}

/**
 * Build claude CLI args for a given phase. Mirrors the inline arg
 * construction that previously lived in pipeline.ts verbatim.
 */
function buildClaudeArgs(req: ProviderRequest): string[] {
  const modelArgs = req.modelHint ? ['--model', req.modelHint] : [];
  switch (req.phase) {
    case 'plan':
    case 'revision':
    case 'verify': {
      // Analysis phases: stream-json for real-time terminal output,
      // no file-mutating tools. --verbose is required by stream-json mode.
      // maxTurns comes from AppSettings.plannerMaxTurns (default 3) via phaseHints.
      // --max-thinking-tokens enables extended thinking so the terminal
      // drawer can display reasoning blocks. Token budget is controlled by
      // phaseHints.reasoningEffort (high=32000, medium=8000, low=omit).
      const maxTurns = String(req.phaseHints?.maxTurns ?? 1);
      const thinkingTokens = mapReasoningEffortToClaudeThinkingTokens(
        req.phaseHints?.reasoningEffort,
        req.modelHint,
      );
      const args = [
        '-p',
        req.prompt,
        ...modelArgs,
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        maxTurns,
        '--dangerously-skip-permissions',
        '--disallowedTools',
        'Edit,Write,Bash,NotebookEdit',
      ];
      if (thinkingTokens !== null) {
        args.splice(
          args.indexOf('--dangerously-skip-permissions'),
          0,
          '--max-thinking-tokens',
          String(thinkingTokens),
        );
      }
      return args;
    }
    case 'execute': {
      // Execution: full tool surface, no JSON wrapping, no turn limit.
      const execArgs = [
        '-p',
        req.prompt,
        ...modelArgs,
        '--allowedTools',
        'Edit,Write,Bash,Glob,Grep,Read',
        '--dangerously-skip-permissions',
      ];
      const execThinking = mapReasoningEffortToClaudeThinkingTokens(
        req.phaseHints?.reasoningEffort,
        req.modelHint,
      );
      if (execThinking !== null) {
        execArgs.splice(
          execArgs.indexOf('--dangerously-skip-permissions'),
          0,
          '--max-thinking-tokens',
          String(execThinking),
        );
      }
      return execArgs;
    }
    case 'review':
      // Claude does not review in the current pipeline (codex does).
      // Kept for symmetry; always 1 turn (structural, not configurable).
      return [
        '-p',
        req.prompt,
        ...modelArgs,
        '--output-format',
        'json',
        '--max-turns',
        '1',
        '--dangerously-skip-permissions',
        '--disallowedTools',
        'Edit,Write,Bash,NotebookEdit',
      ];
  }
}

/**
 * Build codex CLI args for a given phase.
 *
 * codex v0.120.0 layout: top-level flags come BEFORE the `exec` subcommand,
 * and the subcommand's own flags (`--sandbox`, `--json`) go after the prompt.
 *
 *   codex [-a never] [-c model_reasoning_effort=high] exec <prompt> --sandbox <level> --json
 *
 * Previously we passed `-a never` AFTER `exec`, which is invalid — codex errors
 * out in ~30ms with `unexpected argument '-a' found` and the pipeline sees an
 * empty review. Same story for `--reasoning-effort`, which was removed as a
 * standalone flag in 0.120.0 and must now be set via `-c model_reasoning_effort=<effort>`.
 */
function buildCodexArgs(req: ProviderRequest): string[] {
  const sandbox = req.phase === 'execute' ? 'workspace-write' : 'read-only';
  const topLevelFlags: string[] = ['-a', 'never'];
  if (req.modelHint) topLevelFlags.push('-m', req.modelHint);
  // Default to high reasoning so thinking output is always visible in the terminal.
  const effort = mapReasoningEffortToCodex(req.phaseHints?.reasoningEffort, req.modelHint);
  topLevelFlags.push('-c', `model_reasoning_effort=${effort}`);
  return [...topLevelFlags, 'exec', req.prompt, '--sandbox', sandbox, '--json'];
}

export function createClaudeCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'claude-cli',
    supports: new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify', 'execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const args = buildClaudeArgs(req);
      const result = await runCli(
        processManager,
        'claude',
        args,
        req.cwd,
        req.signal,
        req.threadId,
      );
      const parser = new StreamParser();
      parser.feed(result.rawOutput);
      const usage = parser.extractUsage();
      return {
        rawOutput: StreamParser.stripSystemEvents(result.rawOutput),
        exitCode: result.exitCode,
        resolvedModel: parser.extractModel() ?? 'claude',
        ...(usage
          ? {
              tokensUsed: { prompt: usage.inputTokens, completion: usage.outputTokens },
              costUsd: usage.costUsd,
            }
          : {}),
        ...(result.exitCode === 127
          ? {
              providerError: {
                kind: 'binary_missing' as const,
                message: 'claude CLI not found on PATH',
                retryable: false,
              },
            }
          : result.exitCode === 130
            ? { providerError: { kind: 'network' as const, message: 'aborted', retryable: false } }
            : {}),
      };
    },
    async healthCheck() {
      // Healthcheck for the CLI provider is handled by the existing
      // health-check module (checkClaudeAuth). This stub keeps the
      // provider interface uniform.
      return { ok: true };
    },
  };
}

export function createCodexCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'codex-cli',
    supports: new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify', 'execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const args = buildCodexArgs(req);
      const result = await runCli(processManager, 'codex', args, req.cwd, req.signal, req.threadId);
      const parser = new StreamParser();
      parser.feed(result.rawOutput);
      const usage = parser.extractUsage();
      return {
        rawOutput: result.rawOutput,
        exitCode: result.exitCode,
        resolvedModel: 'codex',
        ...(usage
          ? {
              tokensUsed: { prompt: usage.inputTokens, completion: usage.outputTokens },
              costUsd: usage.costUsd,
            }
          : {}),
        ...(result.exitCode === 127
          ? {
              providerError: {
                kind: 'binary_missing' as const,
                message: 'codex CLI not found on PATH',
                retryable: false,
              },
            }
          : result.exitCode === 130
            ? { providerError: { kind: 'network' as const, message: 'aborted', retryable: false } }
            : {}),
      };
    },
    async healthCheck() {
      return { ok: true };
    },
  };
}

// Exported for unit testing (snapshot regression against pipeline.ts).
export const _internals = {
  buildClaudeArgs,
  buildCodexArgs,
};
