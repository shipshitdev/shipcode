import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import type { AgentProvider, ProviderPhase, ProviderRequest, ProviderResponse } from './types';

interface CursorCommand {
  args: string[];
  stdin: string;
}

interface CursorRunResult {
  rawOutput: string;
  exitCode: number;
}

const CURSOR_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  // Optional headless fallback when the CLI is not interactively logged in.
  'CURSOR_API_KEY',
] as const;

type ProcessManagerWithStdin = ProcessManager & {
  spawnWithStdin?: (
    type: 'cursor',
    command: string,
    args: string[],
    cwd: string,
    input: string,
    threadId?: string,
    options?: Parameters<ProcessManager['spawn']>[5],
  ) => ReturnType<ProcessManager['spawn']>;
};

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

function buildCursorCommand(req: ProviderRequest): CursorCommand {
  // `-p` (print) makes cursor-agent non-interactive; the prompt is piped on
  // stdin. `--output-format json` emits a single result object we can parse.
  const args = ['-p', '--output-format', 'json'];
  if (req.modelHint) args.push('--model', req.modelHint);
  // Cursor has no sandbox flag. Only the execute phase may mutate the tree, so
  // it gets `--force` (auto-apply edits). Read-only phases omit it so the agent
  // cannot write.
  if (req.phase === 'execute') args.push('--force');
  return { args, stdin: req.prompt };
}

async function runCursorCli(
  processManager: ProcessManager,
  command: CursorCommand,
  req: ProviderRequest,
): Promise<CursorRunResult> {
  if (req.signal.aborted) return { rawOutput: '', exitCode: 130 };

  let process: ReturnType<ProcessManager['spawn']>;
  try {
    const options = {
      ...(req.workspaceRoot !== undefined ? { workspaceRoot: req.workspaceRoot } : {}),
      envKeyAllowlist: [...CURSOR_ENV_KEYS],
    };
    const processManagerWithStdin = processManager as ProcessManagerWithStdin;
    if (processManagerWithStdin.spawnWithStdin) {
      process = processManagerWithStdin.spawnWithStdin(
        'cursor',
        'cursor-agent',
        command.args,
        req.cwd,
        command.stdin,
        req.threadId,
        options,
      );
    } else {
      return {
        rawOutput: 'Cursor CLI stdin execution is unavailable',
        exitCode: 1,
      };
    }
  } catch (err) {
    return { rawOutput: err instanceof Error ? err.message : String(err), exitCode: 127 };
  }

  req.onTerminalEvent?.({ kind: 'lifecycle', message: 'Cursor CLI started' });

  return new Promise<CursorRunResult>((resolve) => {
    let rawOutput = '';
    let settled = false;

    const cleanup = () => {
      processManager.removeListener('output', outputHandler);
      processManager.removeListener('exit', exitHandler);
      req.signal.removeEventListener('abort', abortHandler);
    };

    const settle = (result: CursorRunResult) => {
      /* v8 ignore next -- listeners are removed during cleanup; guard is for event races */
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const outputHandler = (processId: string, data: string) => {
      if (processId !== process.id) return;
      rawOutput += data;
      req.onTerminalEvent?.({ kind: 'raw', content: data });
    };

    const exitHandler = (processId: string, exitCode: number) => {
      if (processId !== process.id) return;
      req.onTerminalEvent?.({ kind: 'done' });
      settle({ rawOutput, exitCode });
    };

    const abortHandler = () => {
      try {
        processManager.kill(process.id);
      } catch {
        // Exit handler owns settlement when the process is already gone.
      }
      setTimeout(() => {
        if (!settled) settle({ rawOutput, exitCode: 130 });
      }, 2000);
    };

    processManager.on('output', outputHandler);
    processManager.on('exit', exitHandler);
    req.signal.addEventListener('abort', abortHandler, { once: true });
  });
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractFromResultObject(
  parsed: Record<string, unknown>,
): { text: string; resolvedModel?: string } | null {
  const text = firstString(
    parsed.result,
    parsed.text,
    parsed.response,
    parsed.content,
    parsed.output,
  );
  if (text === null) return null;
  const resolvedModel = firstString(parsed.model, parsed.modelId, parsed.resolvedModel);
  return resolvedModel ? { text, resolvedModel } : { text };
}

/**
 * Parse cursor-agent output. `--output-format json` returns a single result
 * object (`{ type: 'result', result: '<final text>', model, ... }`). If the
 * CLI instead streamed NDJSON, fall back to the last `result` line. When
 * nothing parses, return the cleaned raw text so callers still see something.
 */
function parseCursorOutput(rawOutput: string): { text: string; resolvedModel?: string } {
  const cleaned = stripAnsi(rawOutput).trim();
  if (!cleaned) return { text: '' };

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const extracted = extractFromResultObject(parsed);
    if (extracted) return extracted;
  } catch {
    // Not a single JSON object — try NDJSON (stream-json) below.
  }

  let fallback: { text: string; resolvedModel?: string } | null = null;
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const extracted = extractFromResultObject(obj);
      if (!extracted) continue;
      // Prefer an explicit result event; otherwise keep the last extractable line.
      if (obj.type === 'result') return extracted;
      fallback = extracted;
    } catch {
      // Ignore non-JSON lines.
    }
  }

  return fallback ?? { text: cleaned };
}

function clampCursorFailure(rawOutput: string, prompt: string): string {
  const promptText = stripAnsi(prompt).trim();
  const lines = stripAnsi(rawOutput)
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !promptText || (!promptText.includes(entry) && !entry.includes(promptText)));
  const line =
    lines.find((entry) => /\b(error|failed|unauthorized|auth|permission|denied)\b/i.test(entry)) ??
    lines[0];
  return (line ?? 'Cursor CLI failed').slice(0, 280);
}

export function createCursorCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'cursor-cli',
    // Execute-only: Cursor's CLI cannot run read-only (its sandbox blocks writes
    // outside the workspace but still allows in-worktree edits), so it must not
    // drive plan/review/revision/verify, which the pipeline treats as read-only.
    // Execute intentionally writes inside an isolated worktree.
    supports: new Set<ProviderPhase>(['execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const command = buildCursorCommand(req);
      const result = await runCursorCli(processManager, command, req);
      const parsed = parseCursorOutput(result.rawOutput);
      const promptTelemetry = {
        phase: req.phase,
        promptSize: measurePromptPayload(req.prompt),
        ...(req.promptMaterialSummary ? { selectedMaterials: req.promptMaterialSummary } : {}),
      };

      return {
        rawOutput: parsed.text,
        exitCode: result.exitCode,
        promptTelemetry,
        ...(parsed.resolvedModel ? { resolvedModel: parsed.resolvedModel } : {}),
        ...(result.exitCode === 127
          ? {
              providerError: {
                kind: 'binary_missing' as const,
                message: 'cursor-agent CLI not found on PATH',
                retryable: false,
              },
            }
          : result.exitCode === 130
            ? { providerError: { kind: 'aborted' as const, message: 'aborted', retryable: false } }
            : result.exitCode !== 0
              ? {
                  providerError: {
                    kind: 'unknown' as const,
                    message: clampCursorFailure(result.rawOutput, req.prompt),
                    retryable: true,
                  },
                }
              : {}),
      };
    },
    async healthCheck() {
      return { ok: true };
    },
  };
}

export const _internals = {
  buildCursorCommand,
  parseCursorOutput,
  clampCursorFailure,
};
