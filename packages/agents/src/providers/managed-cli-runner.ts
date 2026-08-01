/**
 * Shared runtime for the *managed* CLI providers (claude, codex).
 *
 * This is the sibling of `stdin-cli-runner.ts`: that module backs the
 * single-shot JSON-over-stdin CLIs (gemini, cursor, grok), this one backs the
 * CLIs that ShipCode drives through ProcessManager/node-pty and that have two
 * distinct transports per phase.
 *
 * Both providers run the same `generate()` sequence and differ only in data —
 * binary name, env allowlist, argument construction, and transcript parsing —
 * so that sequence lives here once and each provider supplies a
 * {@link ManagedCliProviderConfig}. Provider-specific branching belongs in the
 * config hooks, not in this file.
 *
 * Two invariants this module is responsible for enforcing:
 *
 * 1. **Prompts are piped through stdin, never argv.** The programmatic command
 *    type requires `stdin`, so a provider config cannot express a prompt-in-argv
 *    invocation (see `.agents/memory/claude-cli.md` — the CLI argparser breaks
 *    on `---` YAML frontmatter and echoes argv on failure).
 * 2. **Interactive runs never touch the programmatic path.** Interactive
 *    commands are a separate type with no `stdin` at all: the prompt goes to a
 *    file artifact, the real terminal CLI is launched, raw PTY output is wrapped
 *    in ShipCode terminal events, and completion is process exit (see
 *    `.agents/memory/interactive-cli-run-modes.md`).
 */

import { watch as fsWatch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PLAN_FENCE_TAG, REVIEW_FENCE_TAG, VERIFICATION_FENCE_TAG } from '@shipcode/shared';
import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import { StreamParser } from '../stream-parser';
import { awaitManagedProcess, type ManagedProcessResult } from './managed-process';
import type {
  AgentProvider,
  ProviderError,
  ProviderPhase,
  ProviderRequest,
  ProviderResponse,
} from './types';

/** ProcessManager process TYPE tags owned by this family. */
export type ManagedCliAgentId = 'claude' | 'codex';

export interface CliRunResult extends ManagedProcessResult {
  /** The process manager cannot pipe stdin, so the run never started. */
  unavailable?: boolean;
}

const STDIN_SPAWN_UNAVAILABLE =
  'This process manager cannot pipe a prompt through stdin (no spawnWithStdin). ShipCode never passes a prompt as a CLI argument, so the run was not started.';

type SpawnOptions = Parameters<ProcessManager['spawn']>[5];

/**
 * A headless invocation. `stdin` is REQUIRED and is the only channel the prompt
 * may travel on — this type is the enforcement point for the stdin-not-argv
 * rule, so there is no shape a config can return that puts a prompt in argv.
 */
export interface ProgrammaticCliCommand {
  args: string[];
  stdin: string;
  options?: SpawnOptions;
}

/**
 * A real-terminal invocation. Deliberately has NO `stdin` field: interactive
 * runs pass a short "read this artifact" instruction as the trailing arg and
 * stream raw PTY output, so nothing about the programmatic transport (`claude
 * -p`, `codex exec`) is reachable from here.
 */
export interface InteractiveCliCommand {
  args: string[];
  options?: SpawnOptions;
}

export type CliCommand = ProgrammaticCliCommand | InteractiveCliCommand;

/** A terminal response returned verbatim, bypassing the normal result assembly. */
export interface ManagedCliRefusal {
  rawOutput: string;
  exitCode: number;
  providerError: ProviderError;
}

/**
 * Outcome of a provider's programmatic-`execute` preflight. Claude uses this to
 * require the `srt` OS sandbox and fail closed when it is missing; codex has no
 * preflight because `codex exec --sandbox` sandboxes itself.
 */
export type ProgrammaticExecutePreflight =
  /** Preflight refused to run. `response` is returned to the pipeline as-is. */
  | { status: 'refused'; response: ManagedCliRefusal }
  /** Preflight produced the command to spawn, plus any wrapper bookkeeping. */
  | {
      status: 'ready';
      command: ProgrammaticCliCommand;
      /**
       * Binary to spawn instead of `agentId`, while keeping the process TYPE tag
       * as the agent (e.g. wrapping `claude` in `srt`). Must be a
       * ProcessManager-allowlisted command.
       */
      commandOverride?: string;
      cleanup?: () => Promise<void>;
      /**
       * Replaces the generic exit-127 error when the *wrapper* fails to launch,
       * so a synchronous spawn error cannot forward local exception text.
       */
      spawnFailure?: ManagedCliRefusal;
    };

/** How a run reached the CLI; passed to the config's parsing hooks. */
export type ManagedCliRunMode = 'programmatic' | 'interactive-execute' | 'interactive-structured';

export interface ManagedCliModelContext {
  req: ProviderRequest;
  /** Raw provider transcript, exactly as the CLI emitted it. */
  transcript: string;
  /** Transcript after `normalizeOutput`, or the artifact contents when present. */
  normalized: string;
  mode: ManagedCliRunMode;
}

export interface ManagedCliFailureContext {
  req: ProviderRequest;
  transcript: string;
  exitCode: number;
  mode: ManagedCliRunMode;
}

export interface ManagedCliProviderConfig {
  id: AgentProvider['id'];
  agentId: ManagedCliAgentId;
  supports: readonly ProviderPhase[];
  /** Env vars forwarded to the child; everything else is stripped. */
  envKeys: readonly string[];
  /** Message for the exit-127 `binary_missing` error. */
  binaryMissingMessage: string;

  /** Headless command for any phase. The prompt always rides `stdin`. */
  buildProgrammaticCommand(req: ProviderRequest): ProgrammaticCliCommand;
  /** Real terminal CLI for `execute`. Must not use `claude -p` / `codex exec`. */
  buildInteractiveExecuteCommand(req: ProviderRequest): Promise<InteractiveCliCommand>;
  /** Real terminal CLI for a structured phase bridged through a file artifact. */
  buildInteractiveStructuredCommand(req: ProviderRequest): Promise<InteractiveCliCommand>;

  /** Provider-native transcript → the text the pipeline parses and displays. */
  normalizeOutput(transcript: string, req: ProviderRequest): string;
  /**
   * Which text carries clarification blocks on the programmatic path. Claude's
   * `stream-json` keeps them in the raw transcript; codex's NDJSON only exposes
   * them after protocol stripping. (Structured runs always read the artifact.)
   */
  clarificationSource: 'transcript' | 'normalized';
  /** Provider-native resolved-model extraction. Nullish omits the field. */
  resolveModel(ctx: ManagedCliModelContext): string | null | undefined;

  /** Optional preflight for programmatic `execute` (Claude's mandatory sandbox). */
  prepareProgrammaticExecute?(req: ProviderRequest): Promise<ProgrammaticExecutePreflight>;
  /**
   * Optional provider-specific failure classification, checked BEFORE the shared
   * exit-code cascade (Claude's Agent-SDK pool exhaustion).
   */
  classifyFailure?(ctx: ManagedCliFailureContext): ProviderError | undefined;
}

type ProcessManagerWithStdin = ProcessManager & {
  spawnWithStdin?: (
    type: ManagedCliAgentId,
    command: string,
    args: string[],
    cwd: string,
    input: string,
    threadId?: string,
    options?: SpawnOptions,
  ) => ReturnType<ProcessManager['spawn']>;
};

function commandStdin(command: CliCommand): string | undefined {
  return 'stdin' in command ? command.stdin : undefined;
}

/**
 * Spawn a CLI via ProcessManager, accumulate output, wait for exit, honoring
 * the abort signal. Shared by both managed providers.
 */
export async function runCli(
  processManager: ProcessManager,
  agentId: ManagedCliAgentId,
  args: string[],
  stdin: string | undefined,
  cwd: string,
  signal: AbortSignal,
  threadId?: string,
  workspaceRoot?: string | null,
  projectPath?: string,
  options?: SpawnOptions,
  onProcessStart?: (processId: string) => void,
  // Spawn a different binary than `agentId` while keeping the process TYPE tag
  // as the agent (e.g. wrap `claude` inside the `srt` OS sandbox). The override
  // must be a ProcessManager-allowlisted command (resolved srt path).
  commandOverride?: string,
): Promise<CliRunResult> {
  if (signal.aborted) {
    return { rawOutput: '', exitCode: 130 };
  }

  const command = commandOverride ?? agentId;
  let process: ReturnType<ProcessManager['spawn']>;
  try {
    const spawnOptions = {
      ...(options ?? {}),
      ...(workspaceRoot !== undefined ? { workspaceRoot, projectPath } : {}),
    };
    if (stdin !== undefined) {
      const spawnWithStdin = (processManager as ProcessManagerWithStdin).spawnWithStdin;
      if (typeof spawnWithStdin !== 'function') {
        // A prompt must NEVER travel via argv (Claude's argparser reads `---`
        // frontmatter as flags and a failing CLI echoes the whole command
        // line). Fail loudly instead of degrading — mirrors stdin-cli-runner.
        return { rawOutput: STDIN_SPAWN_UNAVAILABLE, exitCode: 1, unavailable: true };
      }
      process = spawnWithStdin.call(
        processManager,
        agentId,
        command,
        args,
        cwd,
        stdin,
        threadId,
        spawnOptions,
      );
    } else {
      process = processManager.spawn(agentId, command, args, cwd, threadId, spawnOptions);
    }
  } catch (err) {
    // ProcessManager synthesizes an exit event for missing binaries etc.
    // but if spawn() throws synchronously, surface that as exit 127.
    return {
      rawOutput: err instanceof Error ? err.message : String(err),
      exitCode: 127,
    };
  }
  onProcessStart?.(process.id);
  return awaitManagedProcess({ processManager, process, signal });
}

// ─── Prompt / output artifacts ────────────────────────────────────────────
// Interactive runs cannot receive a prompt on stdin, so the prompt is written
// to the gitignored `.shipcode/runs/` scratch dir and the CLI is told to read
// it. Structured phases bridge their answer back out through a sibling file.

export async function writeExecutePromptArtifact(req: ProviderRequest): Promise<string> {
  const runDir = path.join(req.cwd, '.shipcode', 'runs', req.threadId);
  await fs.mkdir(runDir, { recursive: true });
  const promptPath = path.join(runDir, `${req.phase}-prompt.md`);
  await fs.writeFile(promptPath, req.prompt, 'utf8');
  return promptPath;
}

/**
 * Path the agent writes its structured `shipcode-*` block to when a structured
 * phase runs interactively (no stream-json to parse). Lives in the gitignored
 * `.shipcode/runs/` scratch dir next to the prompt artifact.
 */
export function phaseOutputArtifactPath(req: ProviderRequest): string {
  return path.join(req.cwd, '.shipcode', 'runs', req.threadId, `${req.phase}-output.md`);
}

export async function preparePhaseOutputArtifact(req: ProviderRequest): Promise<string> {
  const outputPath = phaseOutputArtifactPath(req);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.rm(outputPath, { force: true });
  return outputPath;
}

/**
 * Read the structured output artifact after an interactive run, with a short
 * grace window for filesystem flush. Returns null if nothing is written
 * (caller falls back to the raw PTY transcript).
 */
export async function readPhaseOutputArtifact(
  outputPath: string,
  signal: AbortSignal,
): Promise<string | null> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (signal.aborted) return null;
    try {
      const content = await fs.readFile(outputPath, 'utf8');
      if (content.trim()) return content;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

// ─── Instructions shared by both interactive transports ───────────────────

export function buildNativeExecutionGoal(promptArtifactPath: string): string {
  return [
    `/goal Read ${promptArtifactPath} and complete the ShipCode execution task it defines.`,
    'The goal is achieved only when every in-scope plan step and acceptance criterion is implemented,',
    'the verification permitted by the task and repository instructions has been run,',
    'and implementation-notes.md contains the reviewer-facing evidence.',
    'If a real blocker outside your authority prevents completion, document it in implementation-notes.md',
    'and report the blocker with concrete evidence instead of looping.',
  ].join(' ');
}

/**
 * Instruction appended as the trailing CLI arg for interactive structured runs.
 * Imperative + last-sentence so the agent reliably (a) reads the prompt, (b)
 * writes ONLY the fenced block to the output file, (c) exits the REPL.
 */
export function buildStructuredInstruction(
  promptPath: string,
  outputPath: string,
  fenceTag: string,
): string {
  return [
    `Read ${promptPath} and follow its instructions for the ShipCode task.`,
    `When you have your final answer, write ONLY the \`\`\`${fenceTag} fenced JSON block to ${outputPath} (no prose before or after it).`,
    `If you must ask a clarifying question instead, write the \`\`\`shipcode-clarification block to that same file.`,
    `After the file is written, run the command \`exit\` to end this session.`,
  ].join(' ');
}

/** The fenced tag a given structured phase is expected to emit. */
export const PHASE_FENCE_TAG: Partial<Record<ProviderPhase, string>> = {
  plan: PLAN_FENCE_TAG,
  revision: PLAN_FENCE_TAG,
  review: REVIEW_FENCE_TAG,
  verify: VERIFICATION_FENCE_TAG,
};

const INTERACTIVE_STRUCTURED_PHASES: ReadonlySet<ProviderPhase> = new Set([
  'plan',
  'review',
  'revision',
  'verify',
]);

/** True when a structured phase is configured to run via the interactive CLI. */
export function isInteractiveStructured(req: ProviderRequest): boolean {
  return req.phaseHints?.runMode === 'interactive' && INTERACTIVE_STRUCTURED_PHASES.has(req.phase);
}

/** True when `execute` is configured to run via the interactive CLI. */
function isInteractiveExecute(req: ProviderRequest): boolean {
  return req.phaseHints?.runMode === 'interactive' && req.phase === 'execute';
}

/**
 * Run an interactive structured command: spawn via runCli, and in parallel
 * watch for the output artifact. Once it appears, nudge the REPL to exit (the
 * agent is also told to `exit`, so this is a backstop). Completion is still the
 * process exit; the stall watchdog remains the final timeout backstop.
 */
export async function runInteractiveStructured(
  processManager: ProcessManager,
  agentId: ManagedCliAgentId,
  command: CliCommand,
  req: ProviderRequest,
  outputPath: string,
  envKeys: readonly string[],
): Promise<CliRunResult> {
  let watcher: ReturnType<typeof fsWatch> | undefined;
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let capturedId: string | undefined;

  const tryNudgeExit = async (): Promise<void> => {
    if (finished || nudgeTimer || !capturedId) return;
    try {
      const content = await fs.readFile(outputPath, 'utf8');
      if (!content.trim()) return;
    } catch {
      return; // not written yet
    }
    const processId = capturedId;
    nudgeTimer = setTimeout(() => {
      const pm = processManager as ProcessManager & { write?: (id: string, data: string) => void };
      try {
        pm.write?.(processId, '/exit\n');
      } catch {
        // process may already be exiting
      }
    }, 600);
  };

  const composedOnStart = (processId: string) => {
    capturedId = processId;
    req.onProcessStart?.(processId);
    const dir = path.dirname(outputPath);
    const base = path.basename(outputPath);
    try {
      watcher = fsWatch(dir, { persistent: false }, (_event, filename) => {
        if (filename && filename.toString() !== base) return;
        void tryNudgeExit();
      });
    } catch {
      // directory missing briefly — the post-exit read still covers it
    }
    void tryNudgeExit();
  };

  try {
    return await runCli(
      processManager,
      agentId,
      command.args,
      commandStdin(command),
      req.cwd,
      req.signal,
      req.threadId,
      req.workspaceRoot,
      req.projectPath,
      { ...(command.options ?? {}), envKeyAllowlist: [...envKeys] },
      composedOnStart,
    );
  } finally {
    finished = true;
    if (nudgeTimer) clearTimeout(nudgeTimer);
    try {
      watcher?.close();
    } catch {
      // already closed
    }
  }
}

// ─── Shared response assembly ─────────────────────────────────────────────

function buildPromptTelemetry(req: ProviderRequest) {
  return {
    phase: req.phase,
    promptSize: measurePromptPayload(req.prompt),
    ...(req.promptMaterialSummary ? { selectedMaterials: req.promptMaterialSummary } : {}),
  };
}

/**
 * Exit-code → `providerError` cascade shared by every managed CLI run:
 *   - 127 → `binary_missing` (non-retryable)
 *   - 130 → `aborted` (non-retryable)
 * Any other non-zero exit stays unclassified — the phase completion handlers in
 * `pipeline.ts` own what a non-zero exit means per phase.
 */
function classifyExitCode(
  exitCode: number,
  binaryMissingMessage: string,
): ProviderError | undefined {
  if (exitCode === 127) {
    return { kind: 'binary_missing', message: binaryMissingMessage, retryable: false };
  }
  if (exitCode === 130) {
    return { kind: 'aborted', message: 'aborted', retryable: false };
  }
  return undefined;
}

function extractClarification(text: string) {
  const parser = new StreamParser();
  parser.feed(text);
  const clarification = parser.extractClarificationRequest();
  return clarification.success && clarification.data ? clarification.data : undefined;
}

function extractUsage(transcript: string) {
  const parser = new StreamParser();
  parser.feed(transcript);
  return parser.extractUsage();
}

/**
 * Interactive structured phases bridge their machine-readable output through a
 * written file artifact instead of the provider's JSON stream, so they avoid
 * the programmatic path entirely while staying parseable downstream. rawOutput
 * carries the artifact contents (or the normalized transcript as a fallback) so
 * the pipeline's existing StreamParser path needs no changes.
 *
 * Deliberately omits usage/cost: an interactive session reports no per-run
 * token telemetry, and inventing it would misattribute spend.
 */
async function generateInteractiveStructured(
  processManager: ProcessManager,
  config: ManagedCliProviderConfig,
  req: ProviderRequest,
): Promise<ProviderResponse> {
  const command = await config.buildInteractiveStructuredCommand(req);
  const outputPath = phaseOutputArtifactPath(req);
  const result = await runInteractiveStructured(
    processManager,
    config.agentId,
    command,
    req,
    outputPath,
    config.envKeys,
  );

  const artifact = await readPhaseOutputArtifact(outputPath, req.signal);
  const normalized = artifact ?? config.normalizeOutput(result.rawOutput, req);
  const clarificationRequest = extractClarification(normalized);
  const resolvedModel = config.resolveModel({
    req,
    transcript: result.rawOutput,
    normalized,
    mode: 'interactive-structured',
  });
  const providerError = classifyExitCode(result.exitCode, config.binaryMissingMessage);

  return {
    rawOutput: normalized,
    exitCode: result.exitCode,
    ...(resolvedModel ? { resolvedModel } : {}),
    promptTelemetry: buildPromptTelemetry(req),
    ...(clarificationRequest ? { clarificationRequest } : {}),
    ...(providerError ? { providerError } : {}),
  };
}

/**
 * Build the provider that both managed CLIs are instances of.
 *
 * The phase/transport routing below is the single place either provider decides
 * how to run; everything that differs between them arrives through `config`.
 */
export function createManagedCliProvider(
  processManager: ProcessManager,
  config: ManagedCliProviderConfig,
): AgentProvider {
  return {
    id: config.id,
    supports: new Set<ProviderPhase>(config.supports),

    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      if (isInteractiveStructured(req)) {
        return generateInteractiveStructured(processManager, config, req);
      }

      const promptTelemetry = buildPromptTelemetry(req);
      // `interactive` is true only when this run avoids the programmatic path
      // entirely (real terminal CLI on the interactive subscription seat).
      const interactive = isInteractiveExecute(req);
      const mode: ManagedCliRunMode = interactive ? 'interactive-execute' : 'programmatic';

      let command: CliCommand;
      let commandOverride: string | undefined;
      let cleanup: (() => Promise<void>) | undefined;
      let spawnFailure: ManagedCliRefusal | undefined;

      if (interactive) {
        command = await config.buildInteractiveExecuteCommand(req);
      } else if (req.phase === 'execute' && config.prepareProgrammaticExecute) {
        // Providers whose programmatic execute is unsafe on its own (Claude:
        // host Edit/Write/Bash with no built-in OS sandbox) gate it here and
        // fail closed rather than ever running unwrapped.
        const preflight = await config.prepareProgrammaticExecute(req);
        if (preflight.status === 'refused') {
          return { ...preflight.response, promptTelemetry };
        }
        command = preflight.command;
        commandOverride = preflight.commandOverride;
        cleanup = preflight.cleanup;
        spawnFailure = preflight.spawnFailure;
        if (cleanup) {
          // Remove wrapper state promptly on abort instead of waiting out
          // runCli's kill grace window. Cleanups are idempotent, so the
          // `finally` below double-calling is harmless.
          req.signal.addEventListener('abort', () => void cleanup?.(), { once: true });
        }
      } else {
        command = config.buildProgrammaticCommand(req);
      }

      let result: CliRunResult;
      try {
        result = await runCli(
          processManager,
          config.agentId,
          command.args,
          commandStdin(command),
          req.cwd,
          req.signal,
          req.threadId,
          req.workspaceRoot,
          req.projectPath,
          { ...(command.options ?? {}), envKeyAllowlist: [...config.envKeys] },
          req.onProcessStart,
          commandOverride,
        );
      } finally {
        if (cleanup) await cleanup();
      }

      if (result.unavailable) {
        return {
          rawOutput: STDIN_SPAWN_UNAVAILABLE,
          exitCode: result.exitCode,
          promptTelemetry,
          providerError: {
            kind: 'unexpected_stop',
            message: STDIN_SPAWN_UNAVAILABLE,
            retryable: false,
          },
        };
      }

      if (spawnFailure && result.exitCode === 127) {
        // A synchronous ProcessManager spawn error can carry arbitrary local
        // exception text. Keep the wrapper launch failure actionable without
        // forwarding prompt or secret material from that error.
        return { ...spawnFailure, promptTelemetry };
      }

      const normalized = config.normalizeOutput(result.rawOutput, req);
      const usage = extractUsage(result.rawOutput);
      const clarificationRequest = extractClarification(
        config.clarificationSource === 'normalized' ? normalized : result.rawOutput,
      );
      const resolvedModel = config.resolveModel({
        req,
        transcript: result.rawOutput,
        normalized,
        mode,
      });
      const providerError =
        config.classifyFailure?.({
          req,
          transcript: result.rawOutput,
          exitCode: result.exitCode,
          mode,
        }) ?? classifyExitCode(result.exitCode, config.binaryMissingMessage);

      return {
        rawOutput: normalized,
        exitCode: result.exitCode,
        ...(resolvedModel ? { resolvedModel } : {}),
        promptTelemetry,
        /* v8 ignore start -- stream parser extraction is covered directly; provider only forwards parsed metadata */
        ...(usage
          ? {
              tokensUsed: { prompt: usage.inputTokens, completion: usage.outputTokens },
              costUsd: usage.costUsd,
            }
          : {}),
        ...(clarificationRequest ? { clarificationRequest } : {}),
        /* v8 ignore stop */
        ...(providerError ? { providerError } : {}),
      };
    },

    async healthCheck() {
      // Healthcheck for the managed CLI providers is handled by the existing
      // health-check module (checkClaudeAuth). This stub keeps the provider
      // interface uniform.
      return { ok: true };
    },
  };
}
