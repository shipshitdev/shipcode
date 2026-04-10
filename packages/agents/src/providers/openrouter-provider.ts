/**
 * OpenRouter provider implementation.
 *
 * Tier 1: supports PLAN / REVIEW / REVISION / VERIFY. The existing
 * prompt builders in `packages/agents/src/prompts/*` already emit
 * fenced structured blocks (```shipcode-plan, ```shipcode-review,
 * ```shipcode-verification) that the StreamParser knows how to extract.
 * We reuse them as-is and feed the assistant's concatenated text output
 * into the parser at the pipeline level.
 *
 * EXECUTE is Tier 2. For now this provider returns a `not_found`
 * ProviderError so the pipeline's phase-completion logic treats it as
 * a configuration failure rather than silently succeeding.
 *
 * Model resolution order:
 *   1. req.modelHint (per-call override from model-router label)
 *   2. Per-phase AppSettings override (openrouterPlannerModel, etc.)
 *   3. Tier default (openrouterDefaultPaidModel = 'openrouter/auto')
 */

import type { AppSettings } from '@shipcode/shared'
import type {
  AgentProvider,
  ProviderPhase,
  ProviderRequest,
  ProviderResponse,
} from './types'
import type { OpenRouterChatMessage } from './openrouter-http'
import { OpenRouterClient, OpenRouterError } from './openrouter-http'

// System prompts for each phase. The existing prompt builders in
// `packages/agents/src/prompts/` already produce fully-formed user
// prompts with the fenced-block contract embedded, so we only need a
// minimal system prompt reminding the model to emit the contract.
//
// Note the claude/codex CLIs wrap their own system prompts; when we
// route through OpenRouter we lose those wrappers, so we replicate the
// essential structure here.
const SYSTEM_PROMPTS: Record<ProviderPhase, string> = {
  plan: 'You are a senior software engineer creating implementation plans. Emit a single fenced ```shipcode-plan JSON block containing the plan. Do not include any other fenced blocks.',
  review: 'You are a senior software engineer reviewing an implementation plan. Emit a single fenced ```shipcode-review JSON block containing your review. Do not include any other fenced blocks.',
  revision: 'You are a senior software engineer revising an implementation plan based on review feedback. Emit a single fenced ```shipcode-plan JSON block containing the revised plan. Do not include any other fenced blocks.',
  verify: 'You are a senior software engineer verifying that an implementation matches its plan. Emit a single fenced ```shipcode-verification JSON block containing the verification result. Do not include any other fenced blocks.',
  execute: '', // Tier 2
}

export interface OpenRouterProviderDeps {
  /** Reads the current OpenRouter API key from env at call time. */
  getApiKey: () => string | undefined
  /** Reads the latest AppSettings (may change at runtime via IPC). */
  getSettings: () => AppSettings
  /**
   * Factory for the HTTP client. Defaults to `new OpenRouterClient(...)`
   * but can be overridden in tests to inject a mocked client.
   */
  createClient?: (apiKey: string) => OpenRouterClient
}

export function createOpenRouterProvider(deps: OpenRouterProviderDeps): AgentProvider {
  // Tier 1: plan/review/revision/verify. Execute added in Tier 2.
  const supports = new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify'])

  return {
    id: 'openrouter',
    supports,

    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      // Tier 2 guard — explicit error so the pipeline gets a clear
      // signal instead of silently falling through.
      if (req.phase === 'execute') {
        return {
          rawOutput: '',
          exitCode: 1,
          providerError: {
            kind: 'not_found',
            message: 'openrouter execute is not implemented in Tier 1 — use claude or codex',
            retryable: false,
          },
        }
      }

      const apiKey = deps.getApiKey()
      if (!apiKey) {
        return {
          rawOutput: '',
          exitCode: 1,
          providerError: {
            kind: 'auth',
            message: 'OPENROUTER_API_KEY is not set',
            retryable: false,
          },
        }
      }

      const settings = deps.getSettings()
      const model = resolveModel(req, settings)

      const client = deps.createClient
        ? deps.createClient(apiKey)
        : new OpenRouterClient({ apiKey })

      const messages: OpenRouterChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPTS[req.phase] },
        { role: 'user', content: req.prompt },
      ]

      try {
        const result = await client.chat({ model, messages, stream: true }, req.signal)

        // Reconstruct a rawOutput shape that the StreamParser understands:
        // the parser only needs the raw text that contains the fenced
        // block, so we just pass `result.content` through. Tool calls
        // shouldn't appear in Tier 1 phases (we don't pass `tools`).
        return {
          rawOutput: result.content,
          exitCode: 0,
          resolvedModel: result.model ?? model,
          tokensUsed: result.usage
            ? { prompt: result.usage.prompt_tokens, completion: result.usage.completion_tokens }
            : undefined,
        }
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
          }
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
        }
      }
    },

    async healthCheck() {
      const apiKey = deps.getApiKey()
      if (!apiKey) return { ok: false, reason: 'OPENROUTER_API_KEY not set' }
      return { ok: true }
    },
  }
}

/**
 * Resolve which OpenRouter model ID to use for a given request.
 * Precedence: explicit modelHint > per-phase setting override > tier default.
 */
function resolveModel(req: ProviderRequest, settings: AppSettings): string {
  if (req.modelHint) return req.modelHint

  const perPhase = (() => {
    switch (req.phase) {
      case 'plan':
      case 'revision':
        return settings.openrouterPlannerModel
      case 'review':
        return settings.openrouterReviewerModel
      case 'verify':
        return settings.openrouterVerifierModel
      case 'execute':
        return settings.openrouterExecutorModel
    }
  })()

  if (perPhase) return perPhase
  return settings.openrouterDefaultPaidModel
}

export const _internals = { resolveModel, SYSTEM_PROMPTS }
