/**
 * Buffered facade around the pure CLI NDJSON parsers and the fenced-output
 * extractor. Owns the buffer + idle-time bookkeeping; delegates all shape
 * knowledge to `parsers/cli-ndjson.ts` and `parsers/fenced-output.ts`.
 */

import type {
  ClarificationRequest,
  ErrorType,
  PlanReview,
  ShipCodePlan,
  VerificationResult,
} from '@shipcode/shared';
import {
  CLARIFICATION_FENCE_TAG,
  clarificationRequestSchema,
  ERROR_PATTERNS,
  PLAN_FENCE_TAG,
  planReviewSchema,
  REVIEW_FENCE_TAG,
  shipCodePlanSchema,
  VERIFICATION_FENCE_TAG,
  verificationResultSchema,
} from '@shipcode/shared';
import {
  extractClaudeModel,
  extractCliUsage,
  extractCodexModel,
  resolveCliText,
  stripAnsi,
  stripSystemEvents,
} from './parsers/cli-ndjson';
import { extractFencedBlock, type ParseResult } from './parsers/fenced-output';

export type { ParseResult } from './parsers/fenced-output';

export class StreamParser {
  private buffer: string = '';
  private lastOutputTime: number = Date.now();

  feed(chunk: string): void {
    this.buffer += chunk;
    this.lastOutputTime = Date.now();
  }

  reset(): void {
    this.buffer = '';
    this.lastOutputTime = Date.now();
  }

  getRawOutput(): string {
    return this.buffer;
  }

  getTimeSinceLastOutput(): number {
    return Date.now() - this.lastOutputTime;
  }

  extractPlan(): ParseResult<ShipCodePlan> {
    return extractFencedBlock<ShipCodePlan>(
      resolveCliText(this.buffer),
      PLAN_FENCE_TAG,
      shipCodePlanSchema,
    );
  }

  extractClarificationRequest(): ParseResult<ClarificationRequest> {
    return extractFencedBlock<ClarificationRequest>(
      resolveCliText(this.buffer),
      CLARIFICATION_FENCE_TAG,
      clarificationRequestSchema,
    );
  }

  extractReview(): ParseResult<PlanReview> {
    return extractFencedBlock<PlanReview>(
      resolveCliText(this.buffer),
      REVIEW_FENCE_TAG,
      planReviewSchema,
    );
  }

  extractVerification(): ParseResult<VerificationResult> {
    return extractFencedBlock<VerificationResult>(
      resolveCliText(this.buffer),
      VERIFICATION_FENCE_TAG,
      verificationResultSchema,
    );
  }

  extractUsage(): { inputTokens: number; outputTokens: number; costUsd: number } | null {
    return extractCliUsage(this.buffer);
  }

  extractModel(): string | null {
    return extractClaudeModel(this.buffer);
  }

  extractCodexModel(): string | null {
    return extractCodexModel(this.buffer);
  }

  detectError(): { type: ErrorType; match: string } | null {
    const clean = stripAnsi(this.buffer);
    for (const { pattern, type } of ERROR_PATTERNS) {
      const match = clean.match(pattern);
      if (match) {
        return { type, match: match[0] };
      }
    }
    return null;
  }

  static stripSystemEvents(raw: string): string {
    return stripSystemEvents(raw);
  }
}
