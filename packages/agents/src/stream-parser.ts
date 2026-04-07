import { PLAN_FENCE_TAG, REVIEW_FENCE_TAG, VERIFICATION_FENCE_TAG, ERROR_PATTERNS } from '@crosscode/shared'
import type { CrossCodePlan, PlanReview, VerificationResult, ErrorType } from '@crosscode/shared'
import { crossCodePlanSchema, planReviewSchema, verificationResultSchema } from '@crosscode/shared'

export interface ParseResult<T> {
  success: boolean
  data: T | null
  raw: string
  error?: string
}

export class StreamParser {
  private buffer: string = ''
  private lastOutputTime: number = Date.now()

  feed(chunk: string): void {
    this.buffer += chunk
    this.lastOutputTime = Date.now()
  }

  reset(): void {
    this.buffer = ''
    this.lastOutputTime = Date.now()
  }

  getRawOutput(): string {
    return this.buffer
  }

  getTimeSinceLastOutput(): number {
    return Date.now() - this.lastOutputTime
  }

  extractPlan(): ParseResult<CrossCodePlan> {
    return this.extractFencedBlock<CrossCodePlan>(PLAN_FENCE_TAG, crossCodePlanSchema)
  }

  extractReview(): ParseResult<PlanReview> {
    return this.extractFencedBlock<PlanReview>(REVIEW_FENCE_TAG, planReviewSchema)
  }

  extractVerification(): ParseResult<VerificationResult> {
    return this.extractFencedBlock<VerificationResult>(VERIFICATION_FENCE_TAG, verificationResultSchema)
  }

  detectError(): { type: ErrorType; match: string } | null {
    // Strip ANSI codes for pattern matching
    const clean = this.stripAnsi(this.buffer)

    for (const { pattern, type } of ERROR_PATTERNS) {
      const match = clean.match(pattern)
      if (match) {
        return { type, match: match[0] }
      }
    }
    return null
  }

  private extractFencedBlock<T>(tag: string, schema: { parse: (data: unknown) => T }): ParseResult<T> {
    const raw = this.buffer

    // Look for ```tag ... ``` blocks
    const fenceRegex = new RegExp(`\`\`\`${tag}\\s*\\n([\\s\\S]*?)\`\`\``, 'm')
    const match = raw.match(fenceRegex)

    if (!match) {
      // Try to find raw JSON object in the output as fallback
      const jsonMatch = this.tryExtractJson(raw)
      if (jsonMatch) {
        try {
          const parsed = schema.parse(JSON.parse(jsonMatch))
          return { success: true, data: parsed, raw }
        } catch (e) {
          return { success: false, data: null, raw, error: `JSON found but schema validation failed: ${e}` }
        }
      }
      return { success: false, data: null, raw, error: `No ${tag} fenced block found` }
    }

    try {
      const json = JSON.parse(match[1].trim())
      const parsed = schema.parse(json)
      return { success: true, data: parsed, raw }
    } catch (e) {
      return { success: false, data: null, raw, error: `Parse error: ${e}` }
    }
  }

  private tryExtractJson(text: string): string | null {
    // Strip ANSI codes first
    const clean = this.stripAnsi(text)

    // Try to find a JSON object that looks like a plan or review
    const jsonRegex = /\{[\s\S]*?"(?:objective|planId|criteriaResults)"[\s\S]*?\}/
    const match = clean.match(jsonRegex)
    return match ? match[0] : null
  }

  private stripAnsi(text: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  }
}
