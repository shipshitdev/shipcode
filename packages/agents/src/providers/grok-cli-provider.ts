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

// Grok Build's `--output-format json` result envelope. Field names are the
// only thing that differs from the other execute-only stdin CLIs; the parse
// scaffold lives in stdin-cli-runner so a fix lands for every provider at once.
const GROK_RESULT_ENVELOPE: JsonResultEnvelope = {
  resultFieldNames: ['result', 'text', 'response', 'content', 'output'],
  modelFieldNames: ['model', 'modelId', 'resolvedModel'],
};

function parseGrokOutput(rawOutput: string): { text: string; resolvedModel?: string } {
  return parseJsonResultWithNdjsonFallback(rawOutput, GROK_RESULT_ENVELOPE);
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
