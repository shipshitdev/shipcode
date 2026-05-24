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

  it('extracts evidence paths and assertion details from visual QA output', () => {
    const raw = `<qa_results>
[
  {
    "flowName": "Create button is pinned top left",
    "passed": false,
    "failureReason": "target x=900, y=700, w=80, h=32 container x=0, y=0, w=1200, h=80",
    "evidencePaths": ["/tmp/qa/create-button.png", "/tmp/qa"],
    "assertions": [
      {
        "name": "Create button is pinned top left",
        "passed": false,
        "expected": "target left/top within 24px of container left/top",
        "actual": "target x=900, y=700, w=80, h=32 container x=0, y=0, w=1200, h=80",
        "evidencePath": "/tmp/qa/create-button.png"
      }
    ]
  }
]
</qa_results>`;

    const results = extractQaFlowResults(raw);

    expect(results).toHaveLength(1);
    expect(results[0].evidencePaths).toEqual(['/tmp/qa/create-button.png', '/tmp/qa']);
    expect(results[0].assertions?.[0]).toEqual({
      name: 'Create button is pinned top left',
      passed: false,
      expected: 'target left/top within 24px of container left/top',
      actual: 'target x=900, y=700, w=80, h=32 container x=0, y=0, w=1200, h=80',
      evidencePath: '/tmp/qa/create-button.png',
    });
  });
});
