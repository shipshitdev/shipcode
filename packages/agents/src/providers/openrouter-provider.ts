/**
 * OpenRouter provider implementation.
 *
 * Supports PLAN / REVIEW / REVISION / VERIFY / EXECUTE. The existing
 * prompt builders in `packages/agents/src/prompts/*` already emit
 * fenced structured blocks (```shipcode-plan, ```shipcode-review,
 * ```shipcode-verification) that the StreamParser knows how to extract.
 * We reuse them as-is and feed the assistant's concatenated text output
 * into the parser at the pipeline level.
 *
 * The execute phase runs through the tool-call harness in
 * `openrouter-execute.ts`, so OpenRouter can mutate the worktree
 * without spawning a local CLI subprocess.
 *
 * Model resolution order:
 *   1. req.modelHint (per-call override from model-router label)
 *   2. Per-phase AppSettings override (openrouterPlannerModel, etc.)
 *   3. Tier default (openrouterDefaultPaidModel = 'openrouter/auto')
 */

import { type AppSettings, normalizeReasoningModelId } from '@shipcode/shared';
import { StreamParser } from '../stream-parser';
import { executeViaOpenRouter } from './openrouter-execute';
import type { OpenRouterChatMessage } from './openrouter-http';
import { OpenRouterClient, OpenRouterError } from './openrouter-http';
import { normalizeOpenRouterReasoningEffort } from './reasoning';
import type { AgentProvider, ProviderPhase, ProviderRequest, ProviderResponse } from './types';

// System prompts for each phase. The existing prompt builders in
// `packages/agents/src/prompts/` already produce fully-formed user
// prompts with the fenced-block contract embedded, so we only need a
// minimal system prompt reminding the model to emit the contract.
//
// Note the claude/codex CLIs wrap their own system prompts; when we
// route through OpenRouter we lose those wrappers, so we replicate the
// essential structure here. The execute phase has its own system
// prompt inside openrouter-execute.ts (the tool-call harness).
const SYSTEM_PROMPTS: Partial<Record<ProviderPhase, string>> = {
  plan: 'You are a senior software engineer creating implementation plans. Emit either a single fenced ```shipcode-plan JSON block containing the plan, or a single fenced ```shipcode-clarification JSON block when user input is required before planning. Do not include any other fenced blocks.',
  review:
    'You are a senior software engineer reviewing an implementation plan. Emit a single fenced ```shipcode-review JSON block containing your review. Do not include any other fenced blocks.',
  revision:
    'You are a senior software engineer revising an implementation plan based on review feedback. Emit either a single fenced ```shipcode-plan JSON block containing the revised plan, or a single fenced ```shipcode-clarification JSON block when user input is required before revising safely. Do not include any other fenced blocks.',
  verify:
    'You are a senior software engineer verifying that an implementation matches its plan. Emit a single fenced ```shipcode-verification JSON block containing the verification result. Do not include any other fenced blocks.',
};

export interface OpenRouterProviderDeps {
  /** Reads the current OpenRouter API key from env at call time. */
  getApiKey: () => string | undefined;
  /** Reads the latest AppSettings (may change at runtime via IPC). */
  getSettings: () => AppSettings;
  /**
   * Factory for the HTTP client. Defaults to `new OpenRouterClient(...)`
   * but can be overridden in tests to inject a mocked client.
   */
  createClient?: (apiKey: string) => OpenRouterClient;
}

export function createOpenRouterProvider(deps: OpenRouterProviderDeps): AgentProvider {
  // All five phases are supported. Execute goes through the tool-call harness
  // in openrouter-execute.ts; the other four go through plain chat.
  const supports = new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify', 'execute']);

  return {
    id: 'openrouter',
    supports,

    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const apiKey = deps.getApiKey();
      if (!apiKey) {
        return {
          rawOutput: '',
          exitCode: 1,
          providerError: {
            kind: 'auth',
            message: 'OPENROUTER_API_KEY is not set',
            retryable: false,
          },
        };
      }

      const settings = deps.getSettings();
      const model = resolveModel(req, settings);

      const client = deps.createClient
        ? deps.createClient(apiKey)
        : new OpenRouterClient({ apiKey });

      // Execute phase runs the tool-call agent loop.
      if (req.phase === 'execute') {
        return executeViaOpenRouter(req, {
          client,
          model,
          onTerminalEvent: req.onTerminalEvent,
        });
      }

      // Everything else is a single streaming chat completion whose
      // content flows into the StreamParser at the pipeline level.
      const systemPrompt = SYSTEM_PROMPTS[req.phase];
      const messages: OpenRouterChatMessage[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: req.prompt });

      try {
        const effort = normalizeOpenRouterReasoningEffort(req.phaseHints?.reasoningEffort, model);
        const result = await client.chat(
          {
            model,
            messages,
            stream: true,
            include_reasoning: effort !== 'none',
            reasoning: { effort },
          },
          req.signal,
          req.onTerminalEvent,
        );

        // Reconstruct a rawOutput shape that the StreamParser understands:
        // the parser only needs the raw text that contains the fenced
        // block, so we just pass `result.content` through. Tool calls
        // shouldn't appear in these phases (we don't pass `tools`).
        return {
          rawOutput: result.content,
          exitCode: 0,
          resolvedModel: result.model ?? model,
          tokensUsed: result.usage
            ? { prompt: result.usage.prompt_tokens, completion: result.usage.completion_tokens }
            : undefined,
          ...(() => {
            const parser = new StreamParser();
            parser.feed(result.content);
            const clarification = parser.extractClarificationRequest();
            return clarification.success && clarification.data
              ? { clarificationRequest: clarification.data }
              : {};
          })(),
        };
      } catch (err) {
        if (err instanceof OpenRouterError) {
          return {
            rawOutput: '',
            exitCode: 1,
            providerError: {
              kind: err.kind === 'aborted' ? 'network' : err.kind,
              message: err.message,
              retryable: err.retryable,
            },
            resolvedModel: model,
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
          resolvedModel: model,
        };
      }
    },

    async healthCheck() {
      const apiKey = deps.getApiKey();
      if (!apiKey) return { ok: false, reason: 'OPENROUTER_API_KEY not set' };
      return { ok: true };
    },
  };
}

/**
 * Resolve which OpenRouter model ID to use for a given request.
 * Precedence: explicit modelHint > per-phase setting override > tier default.
 */
function resolveModel(req: ProviderRequest, settings: AppSettings): string {
  if (req.modelHint) return normalizeReasoningModelId('openrouter', req.modelHint) ?? req.modelHint;

  const perPhase = (() => {
    switch (req.phase) {
      case 'plan':
      case 'revision':
        return settings.openrouterPlannerModel;
      case 'review':
        return settings.openrouterReviewerModel;
      case 'verify':
        return settings.openrouterVerifierModel;
      case 'execute':
        return settings.openrouterExecutorModel;
    }
  })();

  if (perPhase) return normalizeReasoningModelId('openrouter', perPhase) ?? perPhase;
  return (
    normalizeReasoningModelId('openrouter', settings.openrouterDefaultPaidModel) ??
    settings.openrouterDefaultPaidModel
  );
}
