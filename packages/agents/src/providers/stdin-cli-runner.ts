import type { AgentType } from '@shipcode/shared';
import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import type { ProviderRequest, ProviderResponse } from './types';

export interface StdinCliCommand {
  args: string[];
  stdin: string;
}

export interface StdinCliRunResult {
  rawOutput: string;
  exitCode: number;
  unavailable?: boolean;
}

type ProcessManagerWithStdin = ProcessManager & {
  spawnWithStdin?: (
    type: AgentType,
    command: string,
    args: string[],
    cwd: string,
    input: string,
    threadId?: string,
    options?: Parameters<ProcessManager['spawn']>[5],
  ) => ReturnType<ProcessManager['spawn']>;
};

export function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

export async function runStdinCli(
  processManager: ProcessManager,
  req: ProviderRequest,
  config: {
    type: AgentType;
    command: string;
    commandInput: StdinCliCommand;
    envKeys: readonly string[];
    lifecycleMessage: string;
    unavailableMessage: string;
  },
): Promise<StdinCliRunResult> {
  if (req.signal.aborted) return { rawOutput: '', exitCode: 130 };

  let process: ReturnType<ProcessManager['spawn']>;
  try {
    const options = {
      ...(req.workspaceRoot !== undefined ? { workspaceRoot: req.workspaceRoot } : {}),
      envKeyAllowlist: [...config.envKeys],
    };
    const processManagerWithStdin = processManager as ProcessManagerWithStdin;
    if (!processManagerWithStdin.spawnWithStdin) {
      return { rawOutput: config.unavailableMessage, exitCode: 1, unavailable: true };
    }
    process = processManagerWithStdin.spawnWithStdin(
      config.type,
      config.command,
      config.commandInput.args,
      req.cwd,
      config.commandInput.stdin,
      req.threadId,
      options,
    );
  } catch (err) {
    return { rawOutput: err instanceof Error ? err.message : String(err), exitCode: 127 };
  }

  req.onTerminalEvent?.({ kind: 'lifecycle', message: config.lifecycleMessage });

  return new Promise<StdinCliRunResult>((resolve) => {
    let rawOutput = '';
    let settled = false;

    const cleanup = () => {
      processManager.removeListener('output', outputHandler);
      processManager.removeListener('exit', exitHandler);
      req.signal.removeEventListener('abort', abortHandler);
    };

    const settle = (result: StdinCliRunResult) => {
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
    if (req.signal.aborted) abortHandler();
  });
}

export function clampCliFailure(rawOutput: string, prompt: string, fallback: string): string {
  const promptText = stripAnsi(prompt).trim();
  const lines = stripAnsi(rawOutput)
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !promptText || (!promptText.includes(entry) && !entry.includes(promptText)));
  const line =
    lines.find((entry) => /\b(error|failed|unauthorized|auth|permission|denied)\b/i.test(entry)) ??
    lines[0];
  return (line ?? fallback).slice(0, 280);
}

/**
 * Assemble the canonical `ProviderResponse` shared by stdin-based CLI providers
 * (gemini, cursor). They run identically through {@link runStdinCli} and differ
 * only in how output is parsed plus their binary name / failure label, so the
 * telemetry block, parsed-text/resolvedModel forwarding, and the exit-code →
 * `providerError` cascade are factored out here:
 *   - 127 → `binary_missing` (non-retryable)
 *   - 130 → `aborted` (non-retryable)
 *   - unavailable (no stdin spawn support) → `unknown` (non-retryable)
 *   - any other non-zero → `unknown` (retryable)
 */
export function buildStdinCliResponse(
  req: ProviderRequest,
  result: StdinCliRunResult,
  parsed: { text: string; resolvedModel?: string },
  config: {
    binaryMissingMessage: string;
    clampFailure: (rawOutput: string, prompt: string) => string;
  },
): ProviderResponse {
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
            message: config.binaryMissingMessage,
            retryable: false,
          },
        }
      : result.exitCode === 130
        ? { providerError: { kind: 'aborted' as const, message: 'aborted', retryable: false } }
        : result.unavailable
          ? {
              providerError: {
                kind: 'unknown' as const,
                message: config.clampFailure(result.rawOutput, req.prompt),
                retryable: false,
              },
            }
          : result.exitCode !== 0
            ? {
                providerError: {
                  kind: 'unknown' as const,
                  message: config.clampFailure(result.rawOutput, req.prompt),
                  retryable: true,
                },
              }
            : {}),
  };
}
