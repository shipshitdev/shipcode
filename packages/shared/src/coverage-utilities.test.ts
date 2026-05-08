import { describe, expect, it, vi } from 'vitest';
import {
  assessCliModelAvailability,
  assessCliReasoningEffortAvailability,
  fallbackCliModelCapabilities,
  getCapabilityModelOptions,
  getCapabilitySupportedReasoningEfforts,
} from './cli-model-capabilities';
import { clampError, clampTextBlock } from './errors';
import { formatBytes } from './format-bytes';
import { formatClockTime } from './format-clock-time';
import { formatCost } from './format-cost';
import { formatRelativeTime } from './format-relative-time';
import { phaseToProgress } from './pipeline-utils';
import { parseUnifiedDiff } from './unified-diff';

describe('shared utility coverage', () => {
  it('clamps IPC-safe errors and long text blocks', () => {
    expect(clampError(new Error('first line\nstack'), 20)).toBe('first line');
    expect(clampError('x'.repeat(24), 10)).toBe('xxxxxxxxx…');
    expect(clampError({ nope: true })).toBe('Unknown error');

    const clamped = clampTextBlock(` ${'a'.repeat(80)} `, 40);
    expect(clamped).toContain('[truncated');
    expect(clamped.length).toBeLessThanOrEqual(40);
  });

  it('formats compact values for renderer surfaces', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));

      expect(formatBytes(null)).toBe('');
      expect(formatBytes(999)).toBe('999 B');
      expect(formatBytes(2048)).toBe('2.0 KB');
      expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
      expect(formatCost(0)).toBe('$0.00');
      expect(formatCost(0.001)).toBe('< $0.01');
      expect(formatCost(12.345)).toBe('$12.35');
      expect(formatRelativeTime('2026-05-08T11:59:30.000Z')).toBe('30s ago');
      expect(formatRelativeTime('2026-05-08T10:00:00.000Z')).toBe('2h ago');
      expect(formatClockTime('2026-05-08T07:08:09.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses git diff actions and file metadata', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111aaa..222bbb 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 88%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      'diff --git a/src/deleted.ts b/src/deleted.ts',
      'deleted file mode 100644',
      '--- a/src/deleted.ts',
      '+++ /dev/null',
      'diff --git a/src/created.ts b/src/created.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/created.ts',
    ].join('\n');

    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff(diff).map((file) => [file.filePath, file.action])).toEqual([
      ['src/a.ts', 'modify'],
      ['src/new.ts', 'rename'],
      ['src/deleted.ts', 'delete'],
      ['src/created.ts', 'create'],
    ]);
    expect(parseUnifiedDiff(diff)[0]).toMatchObject({
      beforeHash: '111aaa',
      afterHash: '222bbb',
    });
  });

  it('maps pipeline phases and CLI model capability fallbacks', () => {
    expect(phaseToProgress('todo')).toBe(0);
    expect(phaseToProgress('executing')).toBe(72);
    expect(phaseToProgress('done')).toBe(100);
    expect(phaseToProgress('something-else' as never)).toBe(0);

    const fallback = fallbackCliModelCapabilities('codex', '2026-05-08T00:00:00.000Z');
    expect(fallback.source).toBe('fallback');
    expect(fallback.error).toContain('Codex model catalog');
    expect(
      getCapabilityModelOptions({ modelCapabilities: { codex: fallback } } as never, 'codex')
        .length,
    ).toBeGreaterThan(0);
    expect(getCapabilityModelOptions(undefined, 'openrouter')).toEqual([]);
    expect(
      getCapabilitySupportedReasoningEfforts(undefined, 'openrouter', 'openrouter/auto').length,
    ).toBeGreaterThan(0);
    expect(assessCliModelAvailability(undefined, 'openrouter', 'openrouter/auto')).toEqual({
      available: true,
      message: null,
    });
    expect(
      assessCliModelAvailability(
        { modelCapabilities: { codex: fallback } } as never,
        'codex',
        'missing-model',
      ),
    ).toMatchObject({ available: false });
    expect(
      assessCliReasoningEffortAvailability(
        {
          modelCapabilities: {
            claude: fallbackCliModelCapabilities('claude', '2026-05-08T00:00:00.000Z'),
          },
        } as never,
        'claude',
        'claude-opus-4-1',
        'xhigh',
      ),
    ).toMatchObject({ available: false });
  });
});
