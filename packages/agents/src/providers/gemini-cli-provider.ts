import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import { firstString } from './output-summary';
import { clampCliFailure, runStdinCli, type StdinCliCommand, stripAnsi } from './stdin-cli-runner';
import type { AgentProvider, ProviderPhase, ProviderRequest, ProviderResponse } from './types';

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

function buildGeminiCommand(req: ProviderRequest): StdinCliCommand {
  const args = ['-p', '-', '--output-format', 'json'];
  if (req.modelHint) args.push('-m', req.modelHint);
  if (req.phase !== 'execute') {
    args.push('--approval-mode', 'never', '--sandbox', 'read-only');
  } else {
    args.push('--approval-mode', 'never', '--sandbox', 'workspace-write');
  }
  return { args, stdin: req.prompt };
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
  return clampCliFailure(rawOutput, prompt, 'Gemini CLI failed');
}

export function createGeminiCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'gemini-cli',
    supports: new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify', 'execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const command = buildGeminiCommand(req);
      const result = await runStdinCli(processManager, req, {
        type: 'gemini',
        command: 'gemini',
        commandInput: command,
        envKeys: GEMINI_ENV_KEYS,
        lifecycleMessage: 'Gemini CLI started',
        unavailableMessage: 'Gemini CLI stdin execution is unavailable',
      });
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
            : result.unavailable
              ? {
                  providerError: {
                    kind: 'unknown' as const,
                    message: clampGeminiFailure(result.rawOutput, req.prompt),
                    retryable: false,
                  },
                }
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
