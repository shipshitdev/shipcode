import {
  PLAN_FENCE_TAG,
  REVIEW_FENCE_TAG,
  VERIFICATION_FENCE_TAG,
  ERROR_PATTERNS,
} from '@shipcode/shared';
import type { ShipCodePlan, PlanReview, VerificationResult, ErrorType } from '@shipcode/shared';
import { shipCodePlanSchema, planReviewSchema, verificationResultSchema } from '@shipcode/shared';

export interface ParseResult<T> {
  success: boolean;
  data: T | null;
  raw: string;
  error?: string;
}

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
    return this.extractFencedBlock<ShipCodePlan>(PLAN_FENCE_TAG, shipCodePlanSchema);
  }

  extractReview(): ParseResult<PlanReview> {
    return this.extractFencedBlock<PlanReview>(REVIEW_FENCE_TAG, planReviewSchema);
  }

  extractVerification(): ParseResult<VerificationResult> {
    return this.extractFencedBlock<VerificationResult>(
      VERIFICATION_FENCE_TAG,
      verificationResultSchema,
    );
  }

  /**
   * Extract token usage and cost from the raw output.
   *
   * Claude (--output-format stream-json): final `{"type":"result",...}` line
   *   carries `usage.input_tokens`, `usage.output_tokens`, and `total_cost_usd`.
   *
   * Codex (--json): `{"type":"response.output_item.done",...}` and a final
   *   `{"type":"response.completed","response":{"usage":{...}}}` event.
   *
   * Returns null when no usage data can be found (plain-text output, abort, etc.).
   */
  extractUsage(): { inputTokens: number; outputTokens: number; costUsd: number } | null {
    const lines = this.buffer.split('\n');

    // ── Claude stream-json ───────────────────────────────────────────────────
    // Scan from bottom since the result line is always last.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = this.stripAnsi(lines[i]).trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'result' && parsed.usage) {
          return {
            inputTokens: parsed.usage.input_tokens ?? 0,
            outputTokens: parsed.usage.output_tokens ?? 0,
            costUsd: parsed.total_cost_usd ?? parsed.cost_usd ?? 0,
          };
        }
      } catch {
        continue;
      }
    }

    // ── Codex --json ─────────────────────────────────────────────────────────
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        const usage = parsed.response?.usage ?? parsed.usage;
        if (usage && (usage.input_tokens != null || usage.prompt_tokens != null)) {
          return {
            inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
            outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
            costUsd: 0, // Codex CLI doesn't report cost_usd
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  detectError(): { type: ErrorType; match: string } | null {
    // Strip ANSI codes for pattern matching
    const clean = this.stripAnsi(this.buffer);

    for (const { pattern, type } of ERROR_PATTERNS) {
      const match = clean.match(pattern);
      if (match) {
        return { type, match: match[0] };
      }
    }
    return null;
  }

  /**
   * Resolve the buffer text for parsing. When the buffer contains NDJSON
   * (--output-format stream-json), the complete LLM response is in the
   * `result` field of the final `{"type":"result",...}` line. Extract it so
   * fenced-block searches work against the actual LLM text, not raw NDJSON.
   * Falls back to the raw buffer for plain-text output (execute phase, codex).
   */
  private resolveBuffer(): string {
    const lines = this.buffer.split('\n');

    // ── claude --output-format stream-json ──────────────────────────────────
    // The complete LLM text is in the final `{"type":"result","result":"..."}` line.
    // Strip ANSI before parsing — PTY output wraps JSON lines with color codes.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = this.stripAnsi(lines[i]).trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'result' && typeof parsed.result === 'string') {
          return parsed.result;
        }
      } catch {
        continue; // skip non-parseable lines (PTY control sequences, etc.)
      }
    }

    // ── codex exec --json ───────────────────────────────────────────────────
    // The LLM response is split across `item.completed` agent_message events.
    // JSON.parse unescapes the text so fenced-block regexes match real newlines.
    const agentTexts: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed.type === 'item.completed' &&
          parsed.item?.type === 'agent_message' &&
          typeof parsed.item.text === 'string'
        ) {
          agentTexts.push(parsed.item.text);
        }
      } catch {
        // not JSON — skip
      }
    }
    if (agentTexts.length > 0) return agentTexts.join('\n\n');

    return this.buffer;
  }

  private extractFencedBlock<T>(
    tag: string,
    schema: { parse: (data: unknown) => T },
  ): ParseResult<T> {
    const raw = this.buffer; // stored as-is (original output)
    const text = this.resolveBuffer(); // resolved LLM text for parsing

    // Look for ```tag ... ``` blocks
    const fenceRegex = new RegExp(`\`\`\`${tag}\\s*\\n([\\s\\S]*?)\`\`\``, 'm');
    const match = text.match(fenceRegex);

    if (!match) {
      // Try to find raw JSON object in the output as fallback
      const jsonMatch = this.tryExtractJson(text);
      if (jsonMatch) {
        try {
          const parsed = schema.parse(JSON.parse(jsonMatch));
          return { success: true, data: parsed, raw };
        } catch (e) {
          return {
            success: false,
            data: null,
            raw,
            error: `JSON found but schema validation failed: ${e}`,
          };
        }
      }
      return { success: false, data: null, raw, error: `No ${tag} fenced block found` };
    }

    try {
      const json = JSON.parse(match[1].trim());
      const parsed = schema.parse(json);
      return { success: true, data: parsed, raw };
    } catch (e) {
      return { success: false, data: null, raw, error: `Parse error: ${e}` };
    }
  }

  private tryExtractJson(text: string): string | null {
    // Strip ANSI codes first
    const clean = this.stripAnsi(text);

    // Try to find a JSON object that looks like a plan or review
    const jsonRegex = /\{[\s\S]*?"(?:objective|planId|criteriaResults)"[\s\S]*?\}/;
    const match = clean.match(jsonRegex);
    return match ? match[0] : null;
  }

  private stripAnsi(text: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }
}
