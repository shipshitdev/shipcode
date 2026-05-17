import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import type { AgentProvider, ProviderPhase, ProviderRequest, ProviderResponse } from './types';

interface GeminiCommand {
  args: string[];
  stdin: string;
}

interface GeminiRunResult {
  rawOutput: string;
  exitCode: number;
}

const GEMINI_ENV_KEYS = [
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
] as const;

type ProcessManagerWithStdin = ProcessManager & {
  spawnWithStdin?: (
    type: 'gemini',
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

function buildGeminiCommand(req: ProviderRequest): GeminiCommand {
  const args = ['-p', '-', '--output-format', 'json'];
  if (req.modelHint) args.push('-m', req.modelHint);
  if (req.phase !== 'execute') {
    args.push('--approval-mode', 'never', '--sandbox', 'read-only');
  } else {
    args.push('--approval-mode', 'never', '--sandbox', 'workspace-write');
  }
  return { args, stdin: req.prompt };
}

async function runGeminiCli(
  processManager: ProcessManager,
  command: GeminiCommand,
  req: ProviderRequest,
): Promise<GeminiRunResult> {
  if (req.signal.aborted) return { rawOutput: '', exitCode: 130 };

  let process: ReturnType<ProcessManager['spawn']>;
  try {
    const options = {
      ...(req.workspaceRoot !== undefined ? { workspaceRoot: req.workspaceRoot } : {}),
      envKeyAllowlist: [...GEMINI_ENV_KEYS],
    };
    const processManagerWithStdin = processManager as ProcessManagerWithStdin;
    if (processManagerWithStdin.spawnWithStdin) {
      process = processManagerWithStdin.spawnWithStdin(
        'gemini',
        'gemini',
        command.args,
        req.cwd,
        command.stdin,
        req.threadId,
        options,
      );
    } else {
      return {
        rawOutput: 'Gemini CLI stdin execution is unavailable',
        exitCode: 1,
      };
    }
  } catch (err) {
    return { rawOutput: err instanceof Error ? err.message : String(err), exitCode: 127 };
  }

  req.onTerminalEvent?.({ kind: 'lifecycle', message: 'Gemini CLI started' });

  return new Promise<GeminiRunResult>((resolve) => {
    let rawOutput = '';
    let settled = false;

    const cleanup = () => {
      processManager.removeListener('output', outputHandler);
      processManager.removeListener('exit', exitHandler);
      req.signal.removeEventListener('abort', abortHandler);
    };

    const settle = (result: GeminiRunResult) => {
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

function parseGeminiOutput(rawOutput: string): { text: string; resolvedModel?: string } {
  const cleaned = stripAnsi(rawOutput).trim();
  if (!cleaned) return { text: '' };

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const candidate = Array.isArray(parsed.candidates)
      ? (parsed.candidates[0] as Record<string, unknown> | undefined)
      : undefined;
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const partsText = parts
      .map((part) =>
        typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : null,
      )
      .filter((value): value is string => !!value)
      .join('\n');
    const text =
      firstString(parsed.response, parsed.text, parsed.content, parsed.output, partsText) ??
      cleaned;
    const resolvedModel = firstString(parsed.model, parsed.modelId, parsed.resolvedModel);
    return resolvedModel ? { text, resolvedModel } : { text };
  } catch {
    return { text: cleaned };
  }
}

function clampGeminiFailure(rawOutput: string, prompt: string): string {
  const promptText = stripAnsi(prompt).trim();
  const lines = stripAnsi(rawOutput)
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !promptText || (!promptText.includes(entry) && !entry.includes(promptText)));
  const line =
    lines.find((entry) => /\b(error|failed|unauthorized|auth|permission|denied)\b/i.test(entry)) ??
    lines[0];
  return (line ?? 'Gemini CLI failed').slice(0, 280);
}

export function createGeminiCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'gemini-cli',
    supports: new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify', 'execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const command = buildGeminiCommand(req);
      const result = await runGeminiCli(processManager, command, req);
      const parsed = parseGeminiOutput(result.rawOutput);
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
                message: 'gemini CLI not found on PATH',
                retryable: false,
              },
            }
          : result.exitCode === 130
            ? { providerError: { kind: 'aborted' as const, message: 'aborted', retryable: false } }
            : result.exitCode !== 0
              ? {
                  providerError: {
                    kind: 'unknown' as const,
                    message: clampGeminiFailure(result.rawOutput, req.prompt),
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
  buildGeminiCommand,
  parseGeminiOutput,
  clampGeminiFailure,
};
