import type { FeatureQaFlowResult } from '@shipcode/shared';
import { parseFeatureQaFlowResults } from '@shipcode/shared/source';

/**
 * Extract `<qa_results>` JSON from raw verification output.
 * Returns validated flow results or an empty array on parse/validation failure.
 */
export function extractQaFlowResults(rawOutput: string): FeatureQaFlowResult[] {
  const match = rawOutput.match(/<qa_results>\s*([\s\S]*?)\s*<\/qa_results>/);
  if (!match?.[1]) return [];
  try {
    const parsed: unknown = JSON.parse(match[1]);
    return parseFeatureQaFlowResults(parsed);
  } catch {
    return [];
  }
}
