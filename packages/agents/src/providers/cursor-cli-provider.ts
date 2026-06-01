import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import { firstString } from './output-summary';
import { clampCliFailure, runStdinCli, type StdinCliCommand, stripAnsi } from './stdin-cli-runner';
import type { AgentProvider, ProviderPhase, ProviderRequest, ProviderResponse } from './types';

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

function buildCursorCommand(req: ProviderRequest): StdinCliCommand {
  // `-p` (print) makes cursor-agent non-interactive; the prompt is piped on
  // stdin. `--output-format json` emits a single result object we can parse.
  const args = ['-p', '--output-format', 'json'];
  if (req.modelHint) args.push('--model', req.modelHint);
  // This provider is execute-only (see `supports`) because Cursor has no
  // read-only mode. Execute intentionally writes inside an isolated worktree, so
  // it gets `--force` to auto-apply edits without prompting. The phase guard is
  // defensive: if some caller ever invoked another phase directly, it would not
  // receive auto-apply.
  if (req.phase === 'execute') args.push('--force');
  return { args, stdin: req.prompt };
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
  return clampCliFailure(rawOutput, prompt, 'Cursor CLI failed');
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
      const result = await runStdinCli(processManager, req, {
        type: 'cursor',
        command: 'cursor-agent',
        commandInput: command,
        envKeys: CURSOR_ENV_KEYS,
        lifecycleMessage: 'Cursor CLI started',
        unavailableMessage: 'Cursor CLI stdin execution is unavailable',
      });
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
            : result.unavailable
              ? {
                  providerError: {
                    kind: 'unknown' as const,
                    message: clampCursorFailure(result.rawOutput, req.prompt),
                    retryable: false,
                  },
                }
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
