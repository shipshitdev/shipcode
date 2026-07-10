import type { ProcessManager } from '../process-manager';
import { firstString } from './output-summary';
import {
  buildStdinCliResponse,
  clampCliFailure,
  runStdinCli,
  type StdinCliCommand,
  stripAnsi,
} from './stdin-cli-runner';
import type { AgentProvider, ProviderPhase, ProviderRequest, ProviderResponse } from './types';

const GROK_ENV_KEYS = [
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
  'XAI_API_KEY',
] as const;

function buildGrokCommand(req: ProviderRequest): StdinCliCommand {
  // `-p` (print) runs Grok Build non-interactively; the prompt is piped on
  // stdin (headless mode is CI/pipe-oriented). `--output-format json` emits a
  // single result object we can parse. `--no-auto-update` suppresses the
  // background update check that would otherwise pollute headless output.
  const args = ['-p', '--output-format', 'json', '--no-auto-update'];
  if (req.modelHint) args.push('--model', req.modelHint);
  // Execute-only (see `supports`): Grok Build has no read-only sandbox, so it
  // must not drive the read-only phases. Execute intentionally writes inside an
  // isolated worktree, so it gets `--always-approve` to auto-apply edits without
  // prompting. The phase guard is defensive: if some caller ever invoked another
  // phase directly, it would not receive auto-apply.
  if (req.phase === 'execute') args.push('--always-approve');
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
 * Parse Grok Build output. `--output-format json` returns a single result
 * object (`{ type: 'result', result: '<final text>', model, ... }`). If the
 * CLI instead streamed NDJSON (`streaming-json`), fall back to the last
 * `result` line. When nothing parses, return the cleaned raw text so callers
 * still see something.
 */
function parseGrokOutput(rawOutput: string): { text: string; resolvedModel?: string } {
  const cleaned = stripAnsi(rawOutput).trim();
  if (!cleaned) return { text: '' };

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const extracted = extractFromResultObject(parsed);
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

function clampGrokFailure(rawOutput: string, prompt: string): string {
  return clampCliFailure(rawOutput, prompt, 'Grok CLI failed');
}

export function createGrokCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'grok-cli',
    // Execute-only: Grok Build's headless mode has no read-only sandbox (only
    // `--always-approve` auto-write), so it must not drive plan/review/revision/
    // verify, which the pipeline treats as read-only. Execute intentionally
    // writes inside an isolated worktree.
    supports: new Set<ProviderPhase>(['execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const command = buildGrokCommand(req);
      const result = await runStdinCli(processManager, req, {
        type: 'grok',
        command: 'grok',
        commandInput: command,
        envKeys: GROK_ENV_KEYS,
        lifecycleMessage: 'Grok CLI started',
        unavailableMessage: 'Grok CLI stdin execution is unavailable',
      });
      return buildStdinCliResponse(req, result, parseGrokOutput(result.rawOutput), {
        binaryMissingMessage: 'grok CLI not found on PATH',
        clampFailure: clampGrokFailure,
      });
    },
    async healthCheck() {
      return { ok: true };
    },
  };
}

export const _internals = {
  buildGrokCommand,
  parseGrokOutput,
  clampGrokFailure,
};
