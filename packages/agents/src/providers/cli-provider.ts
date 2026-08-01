/**
 * CLI providers wrapping the existing claude/codex subprocess path.
 *
 * Both are instances of the same config-driven factory
 * ({@link createManagedCliProvider} in `./managed-cli-runner`), mirroring how
 * gemini/cursor/grok are built off `./stdin-cli-runner`. Everything below is
 * per-provider *data*: env allowlist, argument construction, and transcript
 * parsing. The run sequence — transport routing, spawn, artifact bridging,
 * response assembly — lives in the factory and is shared verbatim.
 *
 * Prompts are piped through stdin instead of passed as argv. That keeps large
 * issue bodies and YAML-frontmatter skills out of CLI argument parsing while
 * preserving the existing provider lifecycle; the factory's
 * `ProgrammaticCliCommand` type makes stdin the only expressible path.
 */

import { PLAN_FENCE_TAG } from '@shipcode/shared';
import { classifyPoolExhaustion, markPoolExhausted } from '../agent-sdk-pool-state';
import type { ProcessManager } from '../process-manager';
import { buildSandboxedClaudeExecuteCommand } from '../sandbox/srt';
import { StreamParser } from '../stream-parser';
import {
  buildNativeExecutionGoal,
  buildStructuredInstruction,
  createManagedCliProvider,
  type InteractiveCliCommand,
  isInteractiveStructured,
  type ManagedCliFailureContext,
  type ManagedCliModelContext,
  type ManagedCliProviderConfig,
  PHASE_FENCE_TAG,
  type ProgrammaticCliCommand,
  type ProgrammaticExecutePreflight,
  phaseOutputArtifactPath,
  preparePhaseOutputArtifact,
  readPhaseOutputArtifact,
  writeExecutePromptArtifact,
} from './managed-cli-runner';
import { stripAnsi } from './output-summary';
import { mapReasoningEffortToClaudeThinkingTokens, mapReasoningEffortToCodex } from './reasoning';
import {
  type AgentProvider,
  PHASE_TOOL_POLICIES,
  type ProviderPhase,
  type ProviderRequest,
} from './types';

const SUPPORTED_PHASES: readonly ProviderPhase[] = [
  'plan',
  'review',
  'revision',
  'verify',
  'execute',
];

const SRT_POLICY_FAILURE =
  'srt sandbox policy setup failed. Verify sandbox settings, the worktree path, and temporary-directory permissions.';
const SRT_UNAVAILABLE =
  'srt sandbox unavailable. Install or reinstall @anthropic-ai/sandbox-runtime, or switch Claude execute to interactive.';
const SRT_SPAWN_FAILURE =
  'srt sandbox failed to start. Verify @anthropic-ai/sandbox-runtime and Claude CLI installation permissions.';

const CLAUDE_ENV_KEYS = [
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
  'ANTHROPIC_API_KEY',
] as const;

const CODEX_ENV_KEYS = [
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
  'OPENAI_API_KEY',
] as const;

/**
 * Resolve the tool policy for a phase. Explicit phaseHints override the
 * declarative defaults so callers can customize per-run.
 */
function resolveToolPolicy(req: ProviderRequest) {
  const defaults = PHASE_TOOL_POLICIES[req.phase];
  return {
    allowedTools: req.phaseHints?.allowedTools ?? defaults.allowedTools,
    disallowedTools: req.phaseHints?.disallowedTools ?? defaults.disallowedTools,
  };
}

function sanitizeProcessName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function withExecutionGoalContract(prompt: string): string {
  if (prompt.includes('<execution_goal>')) return prompt;
  return [
    '<execution_goal>',
    'Treat completion as a verifiable condition, not merely the end of one response.',
    'Do not finish until every in-scope plan step and acceptance criterion is implemented,',
    'the verification permitted by the task and repository instructions has been run,',
    'and implementation-notes.md contains the reviewer-facing evidence.',
    'If a real blocker outside your authority prevents completion, document it in implementation-notes.md',
    'and report the blocker with concrete evidence.',
    '</execution_goal>',
    '',
    prompt,
  ].join('\n');
}

// ─── claude ───────────────────────────────────────────────────────────────

function injectThinkingTokens(args: string[], req: ProviderRequest): void {
  const tokens = mapReasoningEffortToClaudeThinkingTokens(
    req.phaseHints?.reasoningEffort,
    req.modelHint,
  );
  if (tokens !== null) {
    args.splice(
      args.indexOf('--dangerously-skip-permissions'),
      0,
      '--max-thinking-tokens',
      String(tokens),
    );
  }
}

/** Build claude CLI args/stdin for a given phase. */
function buildClaudeCommand(req: ProviderRequest): ProgrammaticCliCommand {
  const modelArgs = req.modelHint ? ['--model', req.modelHint] : [];
  const { allowedTools, disallowedTools } = resolveToolPolicy(req);

  switch (req.phase) {
    case 'plan':
    case 'revision':
    case 'verify': {
      const maxTurns = String(req.phaseHints?.maxTurns ?? 1);
      const args = [
        '-p',
        ...modelArgs,
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        maxTurns,
        '--dangerously-skip-permissions',
      ];
      /* v8 ignore next -- plan/revision/verify always have default disallowed tools */
      if (disallowedTools) args.push('--disallowedTools', disallowedTools.join(','));
      /* v8 ignore next -- only execute currently has default allowed tools */
      if (allowedTools) args.push('--allowedTools', allowedTools.join(','));
      injectThinkingTokens(args, req);
      return { args, stdin: req.prompt };
    }
    case 'execute': {
      const execArgs = ['-p', ...modelArgs, '--output-format', 'stream-json', '--verbose'];
      /* v8 ignore next -- execute always has default allowed tools */
      if (allowedTools) execArgs.push('--allowedTools', allowedTools.join(','));
      /* v8 ignore next -- execute normally has no disallowed tools unless explicitly configured */
      if (disallowedTools) execArgs.push('--disallowedTools', disallowedTools.join(','));
      // Safe ONLY because `prepareClaudeProgrammaticExecute` always wraps this
      // command in the srt OS sandbox (buildSandboxedClaudeExecuteCommand) and
      // fails closed otherwise. Never spawn these args without that wrapper.
      execArgs.push('--dangerously-skip-permissions');
      injectThinkingTokens(execArgs, req);
      return { args: execArgs, stdin: req.prompt };
    }
    case 'review': // Claude does not review in the current pipeline (codex does).
      // Kept for symmetry; always 1 turn (structural, not configurable).
      {
        const args = [
          '-p',
          ...modelArgs,
          '--output-format',
          'stream-json',
          '--verbose',
          '--max-turns',
          '1',
          '--dangerously-skip-permissions',
        ];
        /* v8 ignore next -- review has default disallowed tools */
        if (disallowedTools) args.push('--disallowedTools', disallowedTools.join(','));
        /* v8 ignore next -- review normally has no allowed tools unless explicitly configured */
        if (allowedTools) args.push('--allowedTools', allowedTools.join(','));
        return { args, stdin: req.prompt };
      }
  }
}

function buildClaudeArgs(req: ProviderRequest): string[] {
  return buildClaudeCommand(req).args;
}

function buildClaudeStdin(req: ProviderRequest): string {
  return buildClaudeCommand(req).stdin;
}

async function buildClaudeInteractiveExecuteCommand(
  req: ProviderRequest,
): Promise<InteractiveCliCommand> {
  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const modelArgs = req.modelHint ? ['--model', req.modelHint] : [];
  const { allowedTools } = resolveToolPolicy(req);
  return {
    args: [
      '--permission-mode',
      'acceptEdits',
      '--tools',
      (allowedTools ?? PHASE_TOOL_POLICIES.execute.allowedTools ?? []).join(','),
      '--name',
      sanitizeProcessName(`shipcode-${req.threadId}`),
      ...modelArgs,
      buildNativeExecutionGoal(promptArtifactPath),
    ],
    options: { outputMode: 'raw' },
  };
}

async function buildClaudeInteractiveStructuredCommand(
  req: ProviderRequest,
): Promise<InteractiveCliCommand> {
  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const outputPath = await preparePhaseOutputArtifact(req);
  const modelArgs = req.modelHint ? ['--model', req.modelHint] : [];
  const fenceTag = PHASE_FENCE_TAG[req.phase] ?? PLAN_FENCE_TAG;
  // plan/revision may inspect the repo to ground their output; review/verify
  // only need to read the prompt and write the result.
  const tools =
    req.phase === 'plan' || req.phase === 'revision' ? 'Read,Write,Glob,Grep' : 'Read,Write';
  return {
    args: [
      '--permission-mode',
      'acceptEdits',
      '--tools',
      tools,
      '--name',
      sanitizeProcessName(`shipcode-${req.threadId}-${req.phase}`),
      ...modelArgs,
      buildStructuredInstruction(promptArtifactPath, outputPath, fenceTag),
    ],
    options: { outputMode: 'raw' },
  };
}

/**
 * Programmatic claude EXECUTE grants host Edit/Write/Bash with no built-in OS
 * sandbox, so it is REQUIRED to run inside the `srt` OS sandbox
 * (Seatbelt/bubblewrap). If the sandbox is disabled (no osSandbox hint) or
 * unavailable (srt not resolvable), this fails closed — the unwrapped command
 * is never spawned. Programmatic structured phases are tool-less and skip this.
 */
async function prepareClaudeProgrammaticExecute(
  req: ProviderRequest,
): Promise<ProgrammaticExecutePreflight> {
  const osSandbox = req.phaseHints?.osSandbox;
  if (osSandbox?.backend !== 'srt') {
    return {
      status: 'refused',
      response: {
        rawOutput:
          'Programmatic Claude execute requires the OS sandbox (srt), which is disabled. Enable claudeExecuteSandboxEnabled, switch this phase to interactive, or use codex (sandboxed via codex exec).',
        exitCode: 1,
        providerError: {
          kind: 'unexpected_stop',
          message: 'programmatic Claude execute requires the OS sandbox',
          retryable: false,
        },
      },
    };
  }

  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const inner = buildClaudeCommand({
    ...req,
    prompt: buildNativeExecutionGoal(promptArtifactPath),
  });

  let sandboxed: Awaited<ReturnType<typeof buildSandboxedClaudeExecuteCommand>>;
  try {
    sandboxed = await buildSandboxedClaudeExecuteCommand({
      worktreePath: req.cwd,
      innerClaudeArgs: inner.args,
      networkPolicy: osSandbox.networkPolicy,
      extraWritePaths: osSandbox.extraWritePaths,
    });
  } catch {
    // Policy errors may contain local paths or caller-controlled values.
    // Return a fixed, bounded diagnostic and never attempt an unsandboxed
    // fallback or expose the prompt/credentials through rawOutput.
    return {
      status: 'refused',
      response: {
        rawOutput: SRT_POLICY_FAILURE,
        exitCode: 1,
        providerError: { kind: 'unexpected_stop', message: SRT_POLICY_FAILURE, retryable: false },
      },
    };
  }

  if (!sandboxed) {
    return {
      status: 'refused',
      response: {
        rawOutput: SRT_UNAVAILABLE,
        exitCode: 127,
        providerError: { kind: 'binary_missing', message: SRT_UNAVAILABLE, retryable: false },
      },
    };
  }

  return {
    status: 'ready',
    command: { args: sandboxed.args, stdin: inner.stdin },
    commandOverride: sandboxed.command,
    cleanup: sandboxed.cleanup,
    spawnFailure: {
      rawOutput: SRT_SPAWN_FAILURE,
      exitCode: 127,
      providerError: { kind: 'binary_missing', message: SRT_SPAWN_FAILURE, retryable: false },
    },
  };
}

function resolveClaudeModel(ctx: ManagedCliModelContext): string | null {
  const transcriptParser = new StreamParser();
  transcriptParser.feed(ctx.transcript);
  const fromTranscript = transcriptParser.extractModel();
  if (fromTranscript || ctx.mode !== 'interactive-structured') return fromTranscript;
  // Interactive runs emit no stream-json, so fall back to whatever model
  // evidence the written artifact happens to carry.
  const artifactParser = new StreamParser();
  artifactParser.feed(ctx.normalized);
  return artifactParser.extractModel();
}

/**
 * Detect Agent-SDK credit-pool exhaustion on the programmatic (`-p`) path.
 * There is no balance API, so we infer it from the failure and flag it
 * process-wide; the pipeline then falls back to interactive.
 */
function classifyClaudeFailure(ctx: ManagedCliFailureContext) {
  if (ctx.mode !== 'programmatic') return undefined;
  if (!classifyPoolExhaustion(ctx.transcript, '', ctx.exitCode)) return undefined;
  markPoolExhausted('Claude Agent-SDK credit pool exhausted');
  return {
    kind: 'agent_sdk_pool_exhausted' as const,
    message: 'Claude Agent-SDK credit pool exhausted — switch this phase to interactive run mode.',
    retryable: false,
  };
}

const CLAUDE_CONFIG: ManagedCliProviderConfig = {
  id: 'claude-cli',
  agentId: 'claude',
  supports: SUPPORTED_PHASES,
  envKeys: CLAUDE_ENV_KEYS,
  binaryMissingMessage: 'claude CLI not found on PATH',
  buildProgrammaticCommand: buildClaudeCommand,
  buildInteractiveExecuteCommand: buildClaudeInteractiveExecuteCommand,
  buildInteractiveStructuredCommand: buildClaudeInteractiveStructuredCommand,
  normalizeOutput: (transcript) => StreamParser.stripSystemEvents(transcript),
  // stream-json carries clarification blocks in the raw transcript.
  clarificationSource: 'transcript',
  resolveModel: resolveClaudeModel,
  prepareProgrammaticExecute: prepareClaudeProgrammaticExecute,
  classifyFailure: classifyClaudeFailure,
};

export function createClaudeCliProvider(processManager: ProcessManager): AgentProvider {
  return createManagedCliProvider(processManager, CLAUDE_CONFIG);
}

// ─── codex ────────────────────────────────────────────────────────────────

function buildCodexPrompt(req: ProviderRequest): string {
  // `codex exec` does not activate native `/goal` handling. Keep the
  // completion condition explicit in the prompt and let ShipCode's
  // verification/retry state machine provide cross-turn continuation.
  if (req.phase === 'execute') return withExecutionGoalContract(req.prompt);

  // Plan and revision phases need to ground their output in the real repo
  // (per plan-generation skill: walk codebase, cite real file paths, reuse
  // real helpers). The sandbox is already read-only, so file reads are safe.
  // Review and verify phases analyze provided text and stay prompt-only to
  // keep token spend predictable.
  const allowInspection = req.phase === 'plan' || req.phase === 'revision';

  const lines = [
    'ShipCode structured-output mode.',
    ...(allowInspection
      ? [
          'You may read files in the working directory to ground your output, but do not run shell commands beyond read-only inspection.',
        ]
      : [
          'Do not run shell commands, inspect files, or use tools in this phase.',
          'Use only the prompt content below.',
        ]),
    'Return only the requested fenced shipcode-* JSON block. Do not include prose or any other fenced blocks.',
    '',
    req.prompt,
  ];
  return lines.join('\n');
}

/**
 * Build codex CLI args for a given phase.
 *
 * codex v0.120.0 layout: top-level flags come BEFORE the `exec` subcommand,
 * and the subcommand's own flags (`--sandbox`, `--json`) go after the prompt.
 *
 *   codex [-a never] [-c model_reasoning_effort=high] exec - --sandbox <level> --json
 *
 * The prompt itself is piped through stdin. Keeping the prompt out of argv
 * avoids shell/arg length limits and keeps logs from accidentally echoing
 * full issue bodies.
 */
function buildCodexCommand(req: ProviderRequest): ProgrammaticCliCommand {
  const defaultPolicy = PHASE_TOOL_POLICIES[req.phase];
  /* v8 ignore next -- all declared Codex phases have a default sandbox */
  const sandbox = req.phaseHints?.sandbox ?? defaultPolicy.sandbox ?? 'read-only';
  const topLevelFlags: string[] = ['-a', 'never'];
  if (req.modelHint) topLevelFlags.push('-m', req.modelHint);
  // Default to high reasoning so thinking output is always visible in the terminal.
  const effort = mapReasoningEffortToCodex(req.phaseHints?.reasoningEffort, req.modelHint);
  topLevelFlags.push('-c', `model_reasoning_effort=${effort}`);
  return {
    args: [...topLevelFlags, 'exec', '-', '--sandbox', sandbox, '--json'],
    stdin: buildCodexPrompt(req),
  };
}

function buildCodexArgs(req: ProviderRequest): string[] {
  return buildCodexCommand(req).args;
}

function buildCodexStdin(req: ProviderRequest): string {
  return buildCodexCommand(req).stdin;
}

async function buildCodexInteractiveExecuteCommand(
  req: ProviderRequest,
): Promise<InteractiveCliCommand> {
  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const defaultPolicy = PHASE_TOOL_POLICIES.execute;
  const sandbox = req.phaseHints?.sandbox ?? defaultPolicy.sandbox ?? 'workspace-write';
  const args = ['-s', sandbox, '-a', 'on-request', '--no-alt-screen'];
  if (req.modelHint) args.push('-m', req.modelHint);
  const effort = mapReasoningEffortToCodex(req.phaseHints?.reasoningEffort, req.modelHint);
  args.push('-c', `model_reasoning_effort=${effort}`);
  args.push(buildNativeExecutionGoal(promptArtifactPath));
  return { args, options: { outputMode: 'raw' } };
}

async function buildCodexInteractiveStructuredCommand(
  req: ProviderRequest,
): Promise<InteractiveCliCommand> {
  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const outputPath = await preparePhaseOutputArtifact(req);
  const fenceTag = PHASE_FENCE_TAG[req.phase] ?? PLAN_FENCE_TAG;
  // workspace-write is required so the agent can write the output artifact —
  // read-only would block the write. Mirrors the interactive execute posture.
  const args = ['-s', 'workspace-write', '-a', 'on-request', '--no-alt-screen'];
  if (req.modelHint) args.push('-m', req.modelHint);
  const effort = mapReasoningEffortToCodex(req.phaseHints?.reasoningEffort, req.modelHint);
  args.push('-c', `model_reasoning_effort=${effort}`);
  args.push(buildStructuredInstruction(promptArtifactPath, outputPath, fenceTag));
  return { args, options: { outputMode: 'raw' } };
}

/**
 * Extract human-readable text from Codex NDJSON protocol output.
 *
 * Codex `--json` mode emits one JSON object per line with types like
 * `thread.started`, `item.completed`, `turn.completed`, etc. The
 * pipeline stores `rawOutput` for display in the error panel — raw
 * NDJSON is unreadable, so we extract agent messages and command
 * output into a plain-text summary.
 */
function stripCodexProtocol(raw: string, options: { includeCommandOutput?: boolean } = {}): string {
  const includeCommandOutput = options.includeCommandOutput ?? true;
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Not JSON — keep as-is (e.g. non-JSON stderr lines)
      lines.push(trimmed);
      continue;
    }
    const item = parsed.item as Record<string, unknown> | undefined;
    if (!item) {
      // Codex protocol events have a string `type` field (e.g. "thread.started").
      // Non-protocol JSON (plan/review/verification blocks) lacks it — keep those.
      if (typeof parsed.type !== 'string') lines.push(trimmed);
      continue;
    }
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      lines.push(item.text);
    } else if (item.type === 'command_execution' && includeCommandOutput) {
      const cmd = item.command as string | undefined;
      const output =
        typeof item.aggregated_output === 'string'
          ? stripAnsi(item.aggregated_output).trimEnd()
          : undefined;
      const exitCode = item.exit_code as number | null | undefined;
      if (cmd) lines.push(`$ ${cmd}`);
      if (output) lines.push(output.trimEnd());
      if (exitCode != null && exitCode !== 0) lines.push(`[exit ${exitCode}]`);
    }
  }
  return lines.join('\n');
}

const CODEX_CONFIG: ManagedCliProviderConfig = {
  id: 'codex-cli',
  agentId: 'codex',
  supports: SUPPORTED_PHASES,
  envKeys: CODEX_ENV_KEYS,
  binaryMissingMessage: 'codex CLI not found on PATH',
  buildProgrammaticCommand: buildCodexCommand,
  buildInteractiveExecuteCommand: buildCodexInteractiveExecuteCommand,
  buildInteractiveStructuredCommand: buildCodexInteractiveStructuredCommand,
  // Command output is only useful for execute; structured phases are never
  // `execute`, so this one rule covers both the main and structured paths.
  normalizeOutput: (transcript, req) =>
    stripCodexProtocol(transcript, { includeCommandOutput: req.phase === 'execute' }),
  // Codex NDJSON only exposes clarification blocks after protocol stripping.
  clarificationSource: 'normalized',
  resolveModel: ({ req, transcript, mode }) => {
    if (mode === 'interactive-structured') return req.modelHint ?? 'codex';
    const parser = new StreamParser();
    parser.feed(transcript);
    return parser.extractCodexModel() ?? req.modelHint ?? 'codex';
  },
};

export function createCodexCliProvider(processManager: ProcessManager): AgentProvider {
  return createManagedCliProvider(processManager, CODEX_CONFIG);
}

/**
 * Exported for unit testing (snapshot regression against pipeline.ts).
 *
 * @knipignore
 */
export const _internals = {
  buildClaudeArgs,
  buildClaudeStdin,
  buildCodexArgs,
  buildCodexStdin,
  buildCodexPrompt,
  buildNativeExecutionGoal,
  withExecutionGoalContract,
  buildClaudeInteractiveStructuredCommand,
  buildCodexInteractiveStructuredCommand,
  buildStructuredInstruction,
  phaseOutputArtifactPath,
  isInteractiveStructured,
  readPhaseOutputArtifact,
  stripCodexProtocol,
};
