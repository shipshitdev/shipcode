import { describe, expect, it } from 'vitest';
import { parseAndValidate } from './auto-commit';

const dirty = new Set(['a.ts', 'b.ts', 'c.ts']);

describe('parseAndValidate', () => {
  it('accepts valid JSON covering full dirty set', () => {
    const raw = JSON.stringify({
      groups: [
        { files: ['a.ts', 'b.ts'], message: 'feat: thing' },
        { files: ['c.ts'], message: 'chore: other' },
      ],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.groups).toHaveLength(2);
  });

  it('strips markdown fences', () => {
    const raw = '```json\n{"groups":[{"files":["a.ts","b.ts","c.ts"],"message":"chore: x"}]}\n```';
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const r = parseAndValidate('not json', dirty);
    expect(r.ok).toBe(false);
  });

  it('rejects hallucinated files', () => {
    const raw = JSON.stringify({
      groups: [{ files: ['a.ts', 'fake.ts'], message: 'feat: x' }],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('hallucinated');
  });

  it('rejects duplicates across groups', () => {
    const raw = JSON.stringify({
      groups: [
        { files: ['a.ts'], message: 'feat: x' },
        { files: ['a.ts', 'b.ts', 'c.ts'], message: 'feat: y' },
      ],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('duplicate');
  });

  it('rejects orphaned files', () => {
    const raw = JSON.stringify({
      groups: [{ files: ['a.ts', 'b.ts'], message: 'feat: x' }],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('orphan');
  });

  it('rejects empty groups array', () => {
    const r = parseAndValidate(JSON.stringify({ groups: [] }), dirty);
    expect(r.ok).toBe(false);
  });

  it('rejects messages over 200 chars', () => {
    const long = 'a'.repeat(201);
    const raw = JSON.stringify({
      groups: [{ files: ['a.ts', 'b.ts', 'c.ts'], message: long }],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(false);
  });
});
