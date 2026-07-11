import type { ProcessManager } from '../process-manager';
import {
  buildStdinCliResponse,
  clampCliFailure,
  type JsonResultEnvelope,
  parseJsonResultWithNdjsonFallback,
  runStdinCli,
  type StdinCliCommand,
} from './stdin-cli-runner';
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

// cursor-agent's `--output-format json` result envelope. Field names are the
// only thing that differs from the other execute-only stdin CLIs; the parse
// scaffold lives in stdin-cli-runner so a fix lands for every provider at once.
const CURSOR_RESULT_ENVELOPE: JsonResultEnvelope = {
  resultFieldNames: ['result', 'text', 'response', 'content', 'output'],
  modelFieldNames: ['model', 'modelId', 'resolvedModel'],
};

function parseCursorOutput(rawOutput: string): { text: string; resolvedModel?: string } {
  return parseJsonResultWithNdjsonFallback(rawOutput, CURSOR_RESULT_ENVELOPE);
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
      return buildStdinCliResponse(req, result, parseCursorOutput(result.rawOutput), {
        binaryMissingMessage: 'cursor-agent CLI not found on PATH',
        clampFailure: clampCursorFailure,
      });
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
