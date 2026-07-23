/**
 * OpenRouter execute harness — the Tier 2 tool-call agent loop.
 *
 * The pipeline's EXECUTE phase historically let the claude/codex CLIs
 * run their own internal tool-call loops. OpenRouter models are just
 * chat completions, so we have to run the loop ourselves:
 *
 *   1. Send prompt + tool schemas
 *   2. If the model returns tool_calls, execute them via the tool
 *      registry and append the results as tool messages
 *   3. Loop until the model stops (finish_reason === 'stop') OR
 *      we hit an iteration cap / token cap / duplicate-call cap
 *   4. Success requires `toolCallsExecuted > 0`. A model that stops
 *      with only text has not actually done any work and is treated
 *      as a retryable failure.
 *
 * Defense in depth:
 *
 *   - Refuse to run when `cwd === projectPath`. The pipeline is
 *     responsible for creating a worktree, but if that ever breaks
 *     we do not mutate the user's working tree.
 *   - `MAX_TOOL_CALL_ITERATIONS` hard cap
 *   - `MAX_EXECUTE_TOTAL_TOKENS` circuit breaker (token count, not $)
 *   - `MAX_DUPLICATE_TOOL_CALLS` fires when the same tool+args hash
 *     repeats N times in a row — catches pathological Read-the-same-
 *     file-forever loops without requiring model cooperation
 */

import path from 'node:path';
import {
  MAX_DUPLICATE_TOOL_CALLS,
  MAX_EXECUTE_TOTAL_TOKENS,
  MAX_TOOL_CALL_ITERATIONS,
} from '@shipcode/shared';
import { assertWorkspaceSafe } from '@shipcode/shared/worktree-path';
import type { TerminalEvent } from '../terminal-events';
import { executeToolCall, getToolSchemas, toolCallHash } from '../tools/registry';
import type { ToolContext } from '../tools/types';
import type { OpenRouterChatMessage } from './openrouter-http';
import { type OpenRouterClient, OpenRouterError } from './openrouter-http';
import { summarizeTerminalText } from './output-summary';
import { normalizeOpenRouterReasoningEffort } from './reasoning';
import type { ProviderRequest, ProviderResponse } from './types';

/**
 * System prompt for the tool-call execute loop. Deliberately terse —
 * the user prompt (from pipeline.ts startExecution) already carries
 * the plan JSON and instructions.
 */
const EXECUTE_SYSTEM_PROMPT =
  `You are ShipCode's autonomous execution agent. Implement the approved plan by calling the provided tools.

Rules:
- Only modify files necessary for the plan. Do not make unrelated refactors.
- Use edit/write to change files, read/glob/grep to navigate, shell for read-only checks (tests, typecheck, git status, git diff).
- Never call git push, reset, checkout, commit, or any mutating subcommand — those are blocked.
- When done, emit a final short assistant message confirming what you changed. Do not call any more tools after that.
- If the plan cannot be completed with the available tools, explain why and stop.`.trim();

const OPENROUTER_EXECUTE_TOOLS = new Set(['edit', 'write', 'read', 'glob', 'grep']);

export interface ExecuteDeps {
  client: OpenRouterClient;
  /**
   * Model slug to use for execute. Caller resolves this from
   * ProviderRequest.modelHint / AppSettings before invoking.
   */
  model: string;
  /** Optional callback for streaming canonical terminal events. */
  onTerminalEvent?: (event: TerminalEvent) => void;
}

/**
 * Run the execute loop. Returns a ProviderResponse mirroring what the
 * other providers return so the pipeline's completion logic stays
 * uniform.
 */
export async function executeViaOpenRouter(
  req: ProviderRequest,
  deps: ExecuteDeps,
): Promise<ProviderResponse> {
  // Defense-in-depth guard. The pipeline is responsible for creating a
  // worktree before calling execute; this refuses to run if that
  // somehow didn't happen.
  if (
    !req.cwd ||
    req.cwd === req.projectPath ||
    path.resolve(req.cwd) === path.resolve(req.projectPath)
  ) {
    return {
      rawOutput: '',
      exitCode: 1,
      providerError: {
        kind: 'unexpected_stop',
        message: 'openrouter execute refuses to run without a worktree (cwd === projectPath)',
        retryable: false,
      },
    };
  }

  try {
    if (req.workspaceRoot === undefined) {
      throw new Error('workspaceRoot is required for OpenRouter execution');
    }
    assertWorkspaceSafe({
      workspacePath: req.cwd,
      workspaceRoot: req.workspaceRoot,
      projectPath: req.projectPath,
    });
  } catch (error) {
    return {
      rawOutput: '',
      exitCode: 1,
      providerError: {
        kind: 'unexpected_stop',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }

  if (req.signal.aborted) {
    return {
      rawOutput: '',
      exitCode: 1,
      providerError: { kind: 'aborted', message: 'aborted before start', retryable: false },
    };
  }

  const toolCtx: ToolContext = {
    worktreePath: req.cwd,
    signal: req.signal,
    threadId: req.threadId,
  };

  const tools = getToolSchemas(OPENROUTER_EXECUTE_TOOLS);
  const messages: OpenRouterChatMessage[] = [
    { role: 'system', content: EXECUTE_SYSTEM_PROMPT },
    { role: 'user', content: req.prompt },
  ];

  let toolCallsExecuted = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let lastResolvedModel: string | undefined;
  const recentHashes: string[] = [];
  const reasoningEffort = normalizeOpenRouterReasoningEffort(
    req.phaseHints?.reasoningEffort,
    deps.model,
  );

  const emit = deps.onTerminalEvent;

  for (let iteration = 0; iteration < MAX_TOOL_CALL_ITERATIONS; iteration++) {
    emit?.({ kind: 'turn_start', turn: iteration + 1 });

    if (req.signal.aborted) {
      return {
        rawOutput: '',
        exitCode: 1,
        providerError: { kind: 'aborted', message: 'aborted', retryable: false },
        resolvedModel: lastResolvedModel,
        tokensUsed: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      };
    }

    let response: Awaited<ReturnType<typeof deps.client.chat>>;
    try {
      // Non-streaming for the tool-call loop. Streaming is optional for
      // long plan/review phases but tool calls are emitted as a single
      // chunk at the end, so we gain nothing from SSE here.
      response = await deps.client.chat(
        {
          model: deps.model,
          messages,
          tools,
          stream: false,
          reasoning: { effort: reasoningEffort },
        },
        req.signal,
      );
    } catch (err) {
      if (err instanceof OpenRouterError) {
        return {
          rawOutput: '',
          exitCode: 1,
          providerError: {
            kind: err.kind,
            message: err.message,
            retryable: err.retryable,
          },
          resolvedModel: lastResolvedModel,
          tokensUsed: { prompt: totalPromptTokens, completion: totalCompletionTokens },
        };
      }
      return {
        rawOutput: '',
        exitCode: 1,
        providerError: {
          kind: 'unknown',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        },
        resolvedModel: lastResolvedModel,
      };
    }

    if (response.model) lastResolvedModel = response.model;
    if (response.usage) {
      totalPromptTokens += response.usage.prompt_tokens;
      totalCompletionTokens += response.usage.completion_tokens;
    }

    emit?.({
      kind: 'turn_end',
      turn: iteration + 1,
      tokensUsed: response.usage
        ? { prompt: response.usage.prompt_tokens, completion: response.usage.completion_tokens }
        : undefined,
    });

    if (totalPromptTokens + totalCompletionTokens > MAX_EXECUTE_TOTAL_TOKENS) {
      return {
        rawOutput: '',
        exitCode: 1,
        providerError: {
          kind: 'tool_loop_overflow',
          message: `exceeded MAX_EXECUTE_TOTAL_TOKENS (${MAX_EXECUTE_TOTAL_TOKENS})`,
          retryable: false,
        },
        resolvedModel: lastResolvedModel,
        tokensUsed: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      };
    }

    // Model is calling tools — execute them, append results, loop.
    if (response.toolCalls.length > 0) {
      // Push the assistant message with tool_calls onto the transcript.
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        if (req.signal.aborted) break;

        // Duplicate-call detector: catches pathological loops.
        const hash = toolCallHash(call.function.name, call.function.arguments);
        recentHashes.push(hash);
        if (recentHashes.length > MAX_DUPLICATE_TOOL_CALLS) recentHashes.shift();
        if (
          recentHashes.length === MAX_DUPLICATE_TOOL_CALLS &&
          recentHashes.every((h) => h === hash)
        ) {
          // Tell the model what happened via a tool-message so it can
          // course-correct, then return a failure so the pipeline can
          // retry at the phase level if appropriate.
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `duplicate tool call detected: the same (${call.function.name}, args) fired ${MAX_DUPLICATE_TOOL_CALLS} times in a row. stopping.`,
          });
          return {
            rawOutput: '',
            exitCode: 1,
            providerError: {
              kind: 'tool_loop_overflow',
              message: `duplicate tool call loop detected on ${call.function.name}`,
              retryable: true,
            },
            resolvedModel: lastResolvedModel,
            tokensUsed: { prompt: totalPromptTokens, completion: totalCompletionTokens },
          };
        }

        // Summarize tool args for terminal display
        let argSummary = '';
        let parsedCommand: string | undefined;
        let parsedFilePath: string | undefined;
        let parsedPattern: string | undefined;
        try {
          const parsed = JSON.parse(call.function.arguments);
          parsedCommand = typeof parsed.command === 'string' ? parsed.command : undefined;
          parsedFilePath = typeof parsed.file_path === 'string' ? parsed.file_path : undefined;
          parsedPattern = typeof parsed.pattern === 'string' ? parsed.pattern : undefined;
          argSummary = parsedFilePath ?? parsedPattern ?? parsedCommand?.slice(0, 60) ?? '';
        } catch {}
        emit?.({
          kind: 'tool_start',
          name: call.function.name,
          summary: `${call.function.name} ${argSummary}`.trim(),
          ...(parsedCommand ? { command: parsedCommand } : {}),
          ...(parsedFilePath ? { filePath: parsedFilePath } : {}),
          ...(parsedPattern ? { pattern: parsedPattern } : {}),
        });

        const toolStart = Date.now();
        const result = await executeToolCall(
          call.function.name,
          call.function.arguments,
          toolCtx,
          OPENROUTER_EXECUTE_TOOLS,
        );
        toolCallsExecuted++;

        emit?.({
          kind: 'tool_end',
          name: call.function.name,
          durationMs: Date.now() - toolStart,
          ...(!result.ok
            ? {
                exitCode: 1,
                outputSummary: summarizeTerminalText(result.error),
              }
            : {}),
        });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.ok ? result.content : `error: ${result.error}`,
        });
      }
      continue;
    }

    // Emit any text content from the model
    if (response.content) {
      emit?.({ kind: 'text', content: response.content });
    }

    // No tool calls this turn. Check finish_reason.
    if (response.finishReason === 'stop') {
      if (toolCallsExecuted === 0) {
        // Model stopped without doing anything — that's not a
        // successful execute. Retryable at the pipeline level.
        return {
          rawOutput: response.content,
          exitCode: 1,
          providerError: {
            kind: 'unexpected_stop',
            message: 'model stopped without executing any tools',
            retryable: true,
          },
          resolvedModel: lastResolvedModel,
          tokensUsed: { prompt: totalPromptTokens, completion: totalCompletionTokens },
        };
      }
      emit?.({
        kind: 'done',
        totalTokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      });
      return {
        rawOutput: response.content,
        exitCode: 0,
        resolvedModel: lastResolvedModel,
        tokensUsed: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      };
    }

    // Any other finish_reason (length, content_filter, etc.) — fail.
    return {
      rawOutput: response.content,
      exitCode: 1,
      providerError: {
        kind: 'unexpected_stop',
        message: `model finished with unexpected reason: ${response.finishReason ?? 'null'}`,
        retryable: false,
      },
      resolvedModel: lastResolvedModel,
      tokensUsed: { prompt: totalPromptTokens, completion: totalCompletionTokens },
    };
  }

  // Iteration cap hit.
  return {
    rawOutput: '',
    exitCode: 1,
    providerError: {
      kind: 'tool_loop_overflow',
      message: `exceeded MAX_TOOL_CALL_ITERATIONS (${MAX_TOOL_CALL_ITERATIONS})`,
      retryable: false,
    },
    resolvedModel: lastResolvedModel,
    tokensUsed: { prompt: totalPromptTokens, completion: totalCompletionTokens },
  };
}
