import type { AgentType } from '@shipcode/shared';
import { stripAnsi } from '@shipcode/shared';
import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import { awaitManagedProcess } from './managed-process';
import { firstString } from './output-summary';
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

export { stripAnsi };

export interface JsonResultEnvelope {
  /** Object keys, in priority order, that may carry the final text. */
  resultFieldNames: readonly string[];
  /** Object keys, in priority order, that may carry the resolved model id. */
  modelFieldNames: readonly string[];
}

function extractFromJsonResult(
  parsed: Record<string, unknown>,
  envelope: JsonResultEnvelope,
): { text: string; resolvedModel?: string } | null {
  const text = firstString(...envelope.resultFieldNames.map((name) => parsed[name]));
  if (text === null) return null;
  const resolvedModel = firstString(...envelope.modelFieldNames.map((name) => parsed[name]));
  return resolvedModel ? { text, resolvedModel } : { text };
}

/**
 * Parse the JSON output shared by the execute-only stdin CLIs (cursor, grok).
 * Their `--output-format json` emits a single result object
 * (`{ type: 'result', result: '<final text>', model, ... }`). If the CLI
 * instead streamed NDJSON (one JSON object per line), fall back to the last
 * extractable line, preferring an explicit `type: 'result'` event. When
 * nothing parses, return the cleaned raw text so callers still see something.
 *
 * The envelope's field names are provider-specific parameters — this stays a
 * thin, shared parse scaffold rather than a per-provider abstraction, so a fix
 * here (BOM/CRLF handling, an added envelope key) lands for every caller at
 * once instead of drifting between near-identical copies.
 */
export function parseJsonResultWithNdjsonFallback(
  rawOutput: string,
  envelope: JsonResultEnvelope,
): { text: string; resolvedModel?: string } {
  const cleaned = stripAnsi(rawOutput).trim();
  if (!cleaned) return { text: '' };

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const extracted = extractFromJsonResult(parsed, envelope);
    if (extracted) return extracted;
  } catch {
    // Not a single JSON object — try NDJSON (streaming-json) below.
  }

  let fallback: { text: string; resolvedModel?: string } | null = null;
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const extracted = extractFromJsonResult(obj, envelope);
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
      ...(req.workspaceRoot !== undefined
        ? { workspaceRoot: req.workspaceRoot, projectPath: req.projectPath }
        : {}),
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
  return awaitManagedProcess({
    processManager,
    process,
    signal: req.signal,
    onOutput: (data) => req.onTerminalEvent?.({ kind: 'raw', content: data }),
    onExit: () => req.onTerminalEvent?.({ kind: 'done' }),
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
 * (gemini, cursor, grok). They run identically through {@link runStdinCli} and differ
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
