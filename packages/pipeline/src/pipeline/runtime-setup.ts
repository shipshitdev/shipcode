import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { loadRepoSetupContract } from '@shipcode/agents';
import { WorktreeManager } from '@shipcode/git';

import type { PipelineContext, PipelineDeps } from '../types';
import type { PipelineRuntime } from './shared';
import { assertPersistedWorktreeTarget } from './worktree-target-guard';

/**
 * Build a fallback install command when a frozen-lockfile install fails
 * because of lockfile drift or a manifest/lockfile mismatch. Returns
 * null when the failure signature doesn't match a known fallback case
 * — the original error stands.
 */
export function buildFrozenInstallFallback(command: string, output: string): string | null {
  const trimmed = command.trim();
  // bun install --frozen-lockfile
  if (/^bun\s+install\s+.*--frozen-lockfile/.test(trimmed)) {
    if (/lockfile|resolution|min[- ]release[- ]age|version mismatch/i.test(output)) {
      return trimmed.replace(/\s*--frozen-lockfile/, '');
    }
    return null;
  }
  // pnpm install --frozen-lockfile
  if (/^pnpm\s+install\s+.*--frozen-lockfile/.test(trimmed)) {
    if (/ERR_PNPM|lockfile|resolution|specifiers in/i.test(output)) {
      return trimmed.replace(/\s*--frozen-lockfile/, '');
    }
    return null;
  }
  // yarn install --frozen-lockfile
  if (/^yarn\s+install\s+.*--frozen-lockfile/.test(trimmed)) {
    if (/lockfile|resolution|YN0028|frozen/i.test(output)) {
      return trimmed.replace(/\s*--frozen-lockfile/, '');
    }
    return null;
  }
  // npm ci → npm install
  if (/^npm\s+ci(\s|$)/.test(trimmed)) {
    if (/EUSAGE|package-lock|lockfile|ELOCK/i.test(output)) {
      return trimmed.replace(/^npm\s+ci/, 'npm install');
    }
    return null;
  }
  return null;
}
const TRUSTED_LOGIN_SHELLS = new Set([
  '/bin/bash',
  '/bin/zsh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
]);

export function resolveSetupShell(
  shellExists: (path: string) => boolean = existsSync,
  preferred = process.env.SHELL,
): { command: string; args: (setupCommand: string) => string[] } {
  if (preferred && TRUSTED_LOGIN_SHELLS.has(preferred) && shellExists(preferred)) {
    return { command: preferred, args: (setupCommand) => ['-ilc', setupCommand] };
  }
  for (const shell of ['/bin/zsh', '/bin/bash']) {
    if (shellExists(shell))
      return { command: shell, args: (setupCommand) => ['-ilc', setupCommand] };
  }
  return { command: '/bin/sh', args: (setupCommand) => ['-c', setupCommand] };
}

type RuntimeSetupHandlers = Pick<
  PipelineRuntime,
  | 'ensureRepoSetupContract'
  | 'runShellCommand'
  | 'prepareWorktree'
  | 'getTestingContext'
  | 'getVerifyCommands'
  | 'buildRepoSetupPlannerNote'
>;

interface RuntimeSetupEnv {
  deps: PipelineDeps;
  emitTerminalRaw: PipelineRuntime['emitTerminalRaw'];
  emitTerminalLifecycle: PipelineRuntime['emitTerminalLifecycle'];
}

export function createRuntimeSetupHandlers({
  deps,
  emitTerminalRaw,
  emitTerminalLifecycle,
}: RuntimeSetupEnv): RuntimeSetupHandlers {
  function ensurePathInsideRoot(root: string, targetPath: string, label: string): string {
    const resolvedRoot = resolve(root);
    const resolvedTarget = resolve(targetPath);
    if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep)) {
      return resolvedTarget;
    }
    throw new Error(`${label} escapes the project root`);
  }

  function ensureRepoSetupContract(context: PipelineContext) {
    if (context.repoSetupLoaded) return context.repoSetupContract;
    context.repoSetupContract = loadRepoSetupContract(context.projectPath);
    context.repoSetupLoaded = true;
    return context.repoSetupContract;
  }

  const SHELL_COMMAND_TIMEOUT_FALLBACK_MS = 10 * 60 * 1000;

  function resolveShellTimeoutMs(context?: PipelineContext): number {
    const override = context?.repoSetupContract?.contract.shellCommandTimeoutMs;
    if (typeof override === 'number' && override > 0) return override;
    const fromSettings = deps.settings.get().shellCommandTimeoutMs;
    if (typeof fromSettings === 'number' && fromSettings > 0) return fromSettings;
    return SHELL_COMMAND_TIMEOUT_FALLBACK_MS;
  }

  async function runShellCommand(
    threadId: string,
    cwd: string,
    command: string,
    signal: AbortSignal,
    options?: {
      extraEnv?: Record<string, string>;
      timeoutMs?: number;
      transientWorktree?: { worktreePath: string; branch: string };
    },
  ): Promise<{ exitCode: number; output: string }> {
    const timeoutMs = options?.timeoutMs ?? resolveShellTimeoutMs();
    const thread = deps.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found for runtime shell command`);
    const project = deps.projects.getById(thread.projectId);
    if (!project)
      throw new Error(`Project ${thread.projectId} not found for runtime shell command`);
    const isProjectRoot = resolve(cwd) === resolve(project.path);
    if (!isProjectRoot) {
      if (options?.transientWorktree) {
        if (options.transientWorktree.worktreePath !== cwd) {
          throw new Error(`Runtime shell path does not match its transient worktree target`);
        }
        const settings = deps.settings.get();
        await new WorktreeManager(project.path, {
          worktreeRoot: settings.worktreeRoot,
          branchFormat: settings.worktreeBranchFormat,
        }).assertRegistered(cwd, options.transientWorktree.branch);
      } else {
        await assertPersistedWorktreeTarget(deps, {
          threadId,
          projectPath: project.path,
          worktreePath: cwd,
        });
      }
    }
    return await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const chunks: string[] = [];
      const shell = resolveSetupShell();
      const workspacePolicy = isProjectRoot
        ? {}
        : { workspaceRoot: deps.settings.get().worktreeRoot, projectPath: project.path };
      const managed = deps.processManager.spawnWithStdin(
        'shell',
        shell.command,
        shell.args(command),
        cwd,
        '',
        threadId,
        {
          detached: true,
          extraEnv: options?.extraEnv,
          ...workspacePolicy,
        },
      );

      const cleanup = () => {
        clearTimeout(timer);
        deps.processManager.removeListener('output', onOutput);
        deps.processManager.removeListener('exit', onExit);
        signal.removeEventListener('abort', onAbort);
      };

      const rejectOnce = (error: Error) => {
        settled = true;
        cleanup();
        rejectPromise(error);
      };

      /**
       * SIGTERM the process group and let the ProcessManager follow up with
       * SIGKILL if the shell ignores it. Escalation lives in the manager
       * because only the manager sees the real exit event and can cancel the
       * pending SIGKILL — this promise has already settled by then.
       */
      const terminate = () => {
        try {
          deps.processManager.kill(managed.id);
        } catch {
          // Process may already be gone; nothing left to escalate.
        }
      };

      const timer = setTimeout(() => {
        if (settled) return;
        emitTerminalRaw(
          threadId,
          `\r\n[shipcode] Command timed out after ${Math.round(timeoutMs / 60_000)}m — killing process.\r\n`,
        );
        terminate();
        rejectOnce(
          new Error(
            `Command timed out after ${Math.round(timeoutMs / 60_000)} minutes: ${command}`,
          ),
        );
      }, timeoutMs);

      const onOutput = (processId: string, chunk: string) => {
        if (processId !== managed.id) return;
        chunks.push(chunk);
        emitTerminalRaw(threadId, chunk);
      };

      const onExit = (processId: string, exitCode: number) => {
        if (processId !== managed.id || settled) return;
        settled = true;
        const output = chunks.join('');
        cleanup();
        resolvePromise({ exitCode, output });
      };

      const onAbort = () => {
        if (settled) return;
        terminate();
        rejectOnce(new Error(`Command aborted: ${command}`));
      };

      deps.processManager.on('output', onOutput);
      deps.processManager.on('exit', onExit);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function prepareWorktree(
    context: PipelineContext,
    stage: 'execute' | 'verify',
    transientWorktree?: { worktreePath: string; branch: string },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const loaded = ensureRepoSetupContract(context);
    if (!loaded || !context.worktreePath) return { ok: true };

    if (transientWorktree) {
      if (transientWorktree.worktreePath !== context.worktreePath) {
        return { ok: false, error: 'Setup path does not match its transient worktree target' };
      }
      try {
        const settings = deps.settings.get();
        await new WorktreeManager(context.projectPath, {
          worktreeRoot: settings.worktreeRoot,
          branchFormat: settings.worktreeBranchFormat,
        }).assertRegistered(context.worktreePath, transientWorktree.branch);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const { contract, path: contractPath } = loaded;
    const shouldRunSetup =
      stage === 'execute' || (stage === 'verify' && contract.setupBeforeVerify);
    if (!shouldRunSetup && contract.envFiles.length === 0) return { ok: true };

    emitTerminalLifecycle(
      context.threadId,
      `[setup] Using repo setup contract ${contractPath}\r\n`,
    );

    for (const envFile of contract.envFiles) {
      try {
        const sourcePath = ensurePathInsideRoot(
          context.projectPath,
          resolve(context.projectPath, envFile.source),
          `env file source "${envFile.source}"`,
        );
        const targetRelative = envFile.target ?? envFile.source;
        const targetPath = ensurePathInsideRoot(
          context.worktreePath,
          resolve(context.worktreePath, targetRelative),
          `env file target "${targetRelative}"`,
        );

        if (!existsSync(sourcePath)) {
          if (envFile.required) {
            return { ok: false, error: `required env file missing: ${envFile.source}` };
          }
          emitTerminalLifecycle(
            context.threadId,
            `[setup] Optional env file missing, skipping ${envFile.source}\r\n`,
          );
          continue;
        }

        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, targetPath);
        emitTerminalLifecycle(
          context.threadId,
          `[setup] Copied ${envFile.source} -> ${targetRelative}\r\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    }

    if (!shouldRunSetup) return { ok: true };

    for (const command of contract.setupCommands) {
      emitTerminalLifecycle(context.threadId, `[setup] $ ${command}\r\n`);
      try {
        const result = await runShellCommand(
          context.threadId,
          context.worktreePath,
          command,
          context.abort.signal,
          transientWorktree ? { transientWorktree } : undefined,
        );
        if (result.exitCode !== 0) {
          const snippet = result.output.trim().split('\n').slice(-3).join(' ').slice(0, 300);
          // Retry a frozen-lockfile install without the freeze flag when
          // the failure looks like lockfile drift / resolution mismatch.
          // Repo-owned lockfiles drift quickly and a hard-fail blocks the
          // whole pipeline; falling back to a normal install matches what
          // a human would do.
          const fallback = buildFrozenInstallFallback(command, result.output);
          if (fallback) {
            emitTerminalLifecycle(
              context.threadId,
              `[setup] frozen install failed — retrying without --frozen-lockfile: $ ${fallback}\r\n`,
            );
            try {
              const retry = await runShellCommand(
                context.threadId,
                context.worktreePath,
                fallback,
                context.abort.signal,
                transientWorktree ? { transientWorktree } : undefined,
              );
              if (retry.exitCode === 0) continue;
              const retrySnippet = retry.output
                .trim()
                .split('\n')
                .slice(-3)
                .join(' ')
                .slice(0, 300);
              return {
                ok: false,
                error: `command failed after fallback (${retry.exitCode}): ${fallback}${retrySnippet ? ` — ${retrySnippet}` : ''}`,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return {
                ok: false,
                error: `command error during fallback: ${fallback} — ${message}`,
              };
            }
          }
          return {
            ok: false,
            error: `command failed (${result.exitCode}): ${command}${snippet ? ` — ${snippet}` : ''}`,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `command error: ${command} — ${message}` };
      }
    }

    return { ok: true };
  }

  function getTestingContext(context: PipelineContext): string | null {
    const loaded = ensureRepoSetupContract(context);
    return loaded?.contract.testingContext ?? deps.settings.get().testingContext;
  }

  function getVerifyCommands(context: PipelineContext): string[] {
    const loaded = ensureRepoSetupContract(context);
    if (loaded && loaded.contract.verifyCommands.length > 0) {
      return loaded.contract.verifyCommands;
    }
    const testCommand = deps.settings.get().testCommand?.trim();
    return testCommand ? [testCommand] : [];
  }

  function buildRepoSetupPlannerNote(context: PipelineContext): string {
    const loaded = ensureRepoSetupContract(context);
    if (!loaded) return '';

    const bits: string[] = [];
    if (loaded.contract.setupCommands.length > 0) {
      bits.push(
        `Setup commands: ${loaded.contract.setupCommands.map((command) => `\`${command}\``).join(', ')}`,
      );
    }
    if (loaded.contract.verifyCommands.length > 0) {
      bits.push(
        `Verification commands: ${loaded.contract.verifyCommands
          .map((command) => `\`${command}\``)
          .join(', ')}`,
      );
    }
    if (loaded.contract.envFiles.length > 0) {
      bits.push(
        `Env files propagated into the worktree: ${loaded.contract.envFiles
          .map((file) => `\`${file.source}\`${file.required ? '' : ' (optional)'}`)
          .join(', ')}`,
      );
    }
    if (bits.length === 0) return '';

    return `\n\n<!-- auto-injected: repo setup contract -->\nNote: This repo defines a setup contract in \`.shipcode/setup.json\`.\n${bits.join('\n')}`;
  }

  return {
    ensureRepoSetupContract,
    runShellCommand,
    prepareWorktree,
    getTestingContext,
    getVerifyCommands,
    buildRepoSetupPlannerNote,
  };
}
