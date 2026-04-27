import { describe, expect, it } from 'vitest';
import { extractExecutionErrorSnippet } from './execution-phases';

describe('extractExecutionErrorSnippet', () => {
  it('returns empty when transcript ends with a shipcode-plan fence', () => {
    const raw = [
      'Some interim chatter',
      '```shipcode-plan',
      '{',
      '  "id": "plan-20260427T154500Z-issue56",',
      '  "threadId": "uKKI_0AnxPOjlKaSwMCkK",',
      '  "objective": "thing"',
      '}',
      '```',
    ].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Some interim chatter');
  });

  it('extracts a structured error from a streaming JSON event', () => {
    const raw = [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","is_error":true,"result":"Tool call denied: write file"}',
    ].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Tool call denied: write file');
  });

  it('extracts a top-level error field when present', () => {
    const raw = '{"error":"ENOENT: missing repo"}';
    expect(extractExecutionErrorSnippet(raw)).toBe('ENOENT: missing repo');
  });

  it('skips bare JSON braces and returns the last plain-text line', () => {
    const raw = ['Network timeout while pushing branch', '{', '  "type": "result"', '}'].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Network timeout while pushing branch');
  });

  it('caps snippet at 280 characters', () => {
    const long = `${'x'.repeat(400)}`;
    expect(extractExecutionErrorSnippet(long).length).toBe(280);
  });

  it('returns empty when no usable text remains', () => {
    expect(extractExecutionErrorSnippet('```\n```\n{}\n[]\n')).toBe('');
  });
});
