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
import type { AgentProvider, ProviderPhase, ProviderRequest, ProviderResponse } from './types';
import { StreamParser } from '../stream-parser';

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
): Promise<CliRunResult> {
  if (signal.aborted) {
    return { rawOutput: '', exitCode: 130 };
  }

  let process: ReturnType<ProcessManager['spawn']>;
  try {
    process = processManager.spawn(agentId, agentId, args, cwd);
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
  switch (req.phase) {
    case 'plan':
    case 'revision':
    case 'verify':
      // Analysis phases: stream-json for real-time terminal output, single turn,
      // no file-mutating tools. --verbose is required by stream-json mode.
      return [
        '-p',
        req.prompt,
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        '1',
        '--dangerously-skip-permissions',
        '--disallowedTools',
        'Edit,Write,Bash,NotebookEdit',
      ];
    case 'execute':
      // Execution: full tool surface, no JSON wrapping.
      return [
        '-p',
        req.prompt,
        '--allowedTools',
        'Edit,Write,Bash,Glob,Grep,Read',
        '--dangerously-skip-permissions',
      ];
    case 'review':
      // Claude does not review in the current pipeline (codex does).
      // Kept for symmetry; returns a safe structured-output invocation.
      return [
        '-p',
        req.prompt,
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
 * Build codex CLI args for a given phase. Mirrors the inline arg
 * construction that previously lived in pipeline.ts verbatim.
 */
function buildCodexArgs(req: ProviderRequest): string[] {
  switch (req.phase) {
    case 'review':
      // Review runs read-only. --json streams NDJSON events for terminal display.
      // --full-auto suppresses interactive approval prompts.
      return ['exec', req.prompt, '--sandbox', 'read-only', '--json', '--full-auto'];
    case 'execute':
      // Execution needs workspace-write. --full-auto = on-request approvals.
      return ['exec', req.prompt, '--sandbox', 'workspace-write', '--json', '--full-auto'];
    case 'plan':
    case 'revision':
    case 'verify':
      // Codex does not handle these phases in the current pipeline.
      return ['exec', req.prompt, '--sandbox', 'read-only', '--json', '--full-auto'];
  }
}

export function createClaudeCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'claude-cli',
    supports: new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify', 'execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const args = buildClaudeArgs(req);
      const result = await runCli(processManager, 'claude', args, req.cwd, req.signal);
      const parser = new StreamParser();
      parser.feed(result.rawOutput);
      const usage = parser.extractUsage();
      return {
        rawOutput: result.rawOutput,
        exitCode: result.exitCode,
        resolvedModel: 'claude',
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
    supports: new Set<ProviderPhase>(['review', 'execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const args = buildCodexArgs(req);
      const result = await runCli(processManager, 'codex', args, req.cwd, req.signal);
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
