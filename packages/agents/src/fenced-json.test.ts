import { describe, expect, it } from 'vitest';
import { extractFencedJson } from './fenced-json';

describe('extractFencedJson', () => {
  it('parses JSON inside a fenced block', () => {
    const text = 'preamble\n```shipcode-prd\n{"title":"x"}\n```\ntrailer';
    expect(extractFencedJson({ text, tag: 'shipcode-prd', label: 'PRD' })).toEqual({ title: 'x' });
  });

  it('parses a fence opened with a trailing info string', () => {
    const text = '```shipcode-prd json\n{"a":1}\n```';
    expect(extractFencedJson({ text, tag: 'shipcode-prd', label: 'PRD' })).toEqual({ a: 1 });
  });

  it('throws a "no fence" error when the tag is absent', () => {
    expect(() =>
      extractFencedJson({ text: 'just prose, no fence', tag: 'shipcode-prd', label: 'PRD' }),
    ).toThrow('No `shipcode-prd` fenced block found in AI response');
  });

  it('throws a distinct "empty fence" error when the fence is present but empty', () => {
    // A loose `!captured.length` check used to misreport this as a missing
    // fence, hiding the real failure mode (model emitted an empty envelope).
    const text = '```shipcode-prd\n```';
    expect(() => extractFencedJson({ text, tag: 'shipcode-prd', label: 'PRD' })).toThrow(
      'Empty `shipcode-prd` fenced block in AI response',
    );
  });

  it('treats a whitespace-only fenced block as empty', () => {
    const text = '```shipcode-prd\n   \n```';
    expect(() => extractFencedJson({ text, tag: 'shipcode-prd', label: 'PRD' })).toThrow(
      'Empty `shipcode-prd` fenced block in AI response',
    );
  });

  it('wraps JSON parse failures with the label and tag', () => {
    const text = '```shipcode-prd\nnot json\n```';
    expect(() => extractFencedJson({ text, tag: 'shipcode-prd', label: 'PRD' })).toThrow(
      /Failed to parse PRD JSON inside `shipcode-prd` block/,
    );
  });
});
