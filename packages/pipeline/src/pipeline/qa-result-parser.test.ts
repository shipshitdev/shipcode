import { describe, expect, it } from 'vitest';
import { extractQaFlowResults } from './qa-result-parser';

describe('extractQaFlowResults', () => {
  it('extracts valid QA flow results from raw output', () => {
    const raw = `Some verification text here.
<qa_results>
[
  { "flowName": "login-flow", "passed": true },
  { "flowName": "checkout-flow", "passed": false, "failureReason": "Missing cart validation" }
]
</qa_results>
More text after.`;

    const results = extractQaFlowResults(raw);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ flowName: 'login-flow', passed: true });
    expect(results[1]).toEqual({
      flowName: 'checkout-flow',
      passed: false,
      failureReason: 'Missing cart validation',
    });
  });

  it('returns empty array when no qa_results tag present', () => {
    expect(extractQaFlowResults('no tags here')).toEqual([]);
  });

  it('returns empty array for empty qa_results tag', () => {
    expect(extractQaFlowResults('<qa_results></qa_results>')).toEqual([]);
  });

  it('returns empty array for invalid JSON inside tag', () => {
    expect(extractQaFlowResults('<qa_results>not json</qa_results>')).toEqual([]);
  });

  it('returns empty array when schema validation fails', () => {
    const raw = '<qa_results>[{ "wrong": "schema" }]</qa_results>';
    expect(extractQaFlowResults(raw)).toEqual([]);
  });

  it('handles whitespace around JSON', () => {
    const raw = `<qa_results>
      [{ "flowName": "test", "passed": true }]
    </qa_results>`;
    const results = extractQaFlowResults(raw);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ flowName: 'test', passed: true });
  });
});
