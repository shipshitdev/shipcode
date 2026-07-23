import { describe, expect, it, vi } from 'vitest';
import {
  assessCliModelAvailability,
  assessCliModelAvailabilityFromCapabilities,
  assessCliReasoningEffortAvailability,
  assessCliReasoningEffortAvailabilityFromCapabilities,
  assessCliSelectionAvailabilityFromCapabilities,
  fallbackCliModelCapabilities,
  getCapabilityModelOptions,
  getCapabilitySupportedReasoningEfforts,
  getProviderModelCapabilitiesFromMap,
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
    expect(clampError(new Error('', { cause: 'empty' }), 20)).toBe('');
    expect(clampError(new Error('first line\nstack'), 20)).toBe('first line');
    expect(clampError('x'.repeat(24), 10)).toBe('xxxxxxxxx…');
    expect(clampError('exact', 5)).toBe('exact');
    expect(clampError({ nope: true })).toBe('Unknown error');

    const clamped = clampTextBlock(` ${'a'.repeat(80)} `, 40);
    expect(clamped).toContain('[truncated');
    expect(clamped.length).toBeLessThanOrEqual(40);
    expect(clampTextBlock(' short ', 20)).toBe('short');
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
      expect(formatRelativeTime('2026-05-08T11:30:00.000Z')).toBe('30m ago');
      expect(formatRelativeTime('2026-05-08T10:00:00.000Z')).toBe('2h ago');
      expect(formatRelativeTime(new Date('2026-05-06T12:00:00.000Z').getTime())).toBe('2d ago');
      expect(formatRelativeTime('2026-05-08T12:00:10.000Z')).toBe('0s ago');
      expect(formatRelativeTime(null)).toBe('-');
      expect(formatRelativeTime('not-a-date')).toBe('-');
      expect(
        formatRelativeTime(new Date('2026-05-08T11:59:30.000Z'), {
          mode: 'past',
          granularity: 'minutes',
          justNowThresholdSec: 45,
        }),
      ).toBe('just now');
      expect(
        formatRelativeTime('2026-05-08T12:15:00.000Z', {
          mode: 'bidirectional',
          granularity: 'minutes',
        }),
      ).toBe('in 15m');
      expect(formatClockTime('2026-05-08T07:08:09.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(formatClockTime(new Date('2026-05-08T07:08:09.000Z'))).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(formatClockTime(new Date('2026-05-08T07:08:09.000Z').getTime())).toMatch(
        /^\d{2}:\d{2}:\d{2}$/,
      );
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
      'diff --git "a/src/space name.ts" "b/src/space name.ts"',
      '--- "a/src/space name.ts"',
      '+++ "b/src/space name.ts"',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');

    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff(diff).map((file) => [file.filePath, file.action])).toEqual([
      ['src/a.ts', 'modify'],
      ['src/new.ts', 'rename'],
      ['src/deleted.ts', 'delete'],
      ['src/created.ts', 'create'],
      ['src/space name.ts', 'modify'],
    ]);
    expect(parseUnifiedDiff(diff)[0]).toMatchObject({
      beforeHash: '111aaa',
      afterHash: '222bbb',
    });
  });

  it('parses unified diff fallbacks for malformed headers and missing paths', () => {
    expect(
      parseUnifiedDiff(
        [
          'diff --git src/no-prefix.ts src/no-prefix.ts',
          'index abc123..def456',
          '--- src/no-prefix.ts',
          '+++ src/no-prefix.ts',
          '@@ -1 +1 @@',
          '-old',
          '+new',
          'diff --git a/src/missing-after.ts b/src/missing-after.ts',
          'deleted file mode 100644',
          '--- a/src/missing-after.ts',
          '+++ /dev/null',
          'diff --git src/delete-after.ts src/delete-after.ts',
          'deleted file mode 100644',
          '+++ b/src/delete-after.ts',
          'diff --git src/delete-fallback.ts src/delete-fallback.ts',
          'deleted file mode 100644',
          'diff --git a/src/no-index.ts b/src/no-index.ts',
          'index not-a-hash..also-not-a-hash',
          '@@ -1 +1 @@',
          '-old',
          '+new',
          'diff --git a/src/empty-rename.ts b/src/empty-rename.ts',
          'rename from ',
          'rename to ',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ].join('\n'),
      ),
    ).toEqual([
      expect.objectContaining({
        filePath: 'src/no-prefix.ts',
        action: 'modify',
        beforeHash: 'abc123',
        afterHash: 'def456',
      }),
      expect.objectContaining({
        filePath: 'src/missing-after.ts',
        action: 'delete',
      }),
      expect.objectContaining({
        filePath: 'src/delete-after.ts',
        action: 'delete',
      }),
      expect.objectContaining({
        filePath: 'changes.patch',
        action: 'delete',
      }),
      expect.objectContaining({
        filePath: 'src/no-index.ts',
        action: 'modify',
        beforeHash: null,
        afterHash: null,
      }),
      expect.objectContaining({
        filePath: 'changes.patch',
        action: 'rename',
      }),
    ]);

    expect(parseUnifiedDiff('diff --git a/unknown b/unknown')).toEqual([
      expect.objectContaining({
        filePath: 'unknown',
        action: 'modify',
      }),
    ]);
  });

  it('maps pipeline phases and CLI model capability fallbacks', () => {
    expect(phaseToProgress('todo')).toBe(0);
    expect(phaseToProgress('executing')).toBe(72);
    expect(phaseToProgress('closed')).toBe(100);
    expect(phaseToProgress('something-else' as never)).toBe(0);

    const fallback = fallbackCliModelCapabilities('codex', '2026-05-08T00:00:00.000Z');
    const geminiFallback = fallbackCliModelCapabilities('gemini', '2026-05-08T00:00:00.000Z');
    expect(fallback.source).toBe('fallback');
    expect(fallback.error).toContain('Codex model catalog');
    expect(geminiFallback.error).toContain('Gemini model catalog');
    expect(fallbackCliModelCapabilities('claude').error).toBeNull();
    expect(getProviderModelCapabilitiesFromMap(null, 'codex').source).toBe('fallback');
    expect(
      getCapabilityModelOptions({ modelCapabilities: { codex: fallback } } as never, 'codex')
        .length,
    ).toBeGreaterThan(0);
    expect(getCapabilityModelOptions(undefined, 'openrouter')).toEqual([]);
    expect(
      getCapabilitySupportedReasoningEfforts(undefined, 'openrouter', 'openrouter/auto').length,
    ).toBeGreaterThan(0);
    expect(
      getCapabilitySupportedReasoningEfforts(
        { modelCapabilities: { codex: fallback } } as never,
        'codex',
        null,
      ),
    ).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(
      getCapabilitySupportedReasoningEfforts(
        { modelCapabilities: { codex: fallback } } as never,
        'codex',
        'missing-model',
      ),
    ).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(assessCliModelAvailability(undefined, 'openrouter', 'openrouter/auto')).toEqual({
      available: true,
      message: null,
    });
    expect(assessCliModelAvailability(undefined, 'codex', null)).toEqual({
      available: true,
      message: null,
    });
    expect(assessCliModelAvailabilityFromCapabilities(null, 'claude', null)).toEqual({
      available: true,
      message: null,
    });
    expect(
      assessCliModelAvailabilityFromCapabilities(
        {
          codex: {
            ...fallback,
            source: 'catalog',
          },
        },
        'codex',
        'gpt-5.5',
      ),
    ).toEqual({ available: true, message: null });
    expect(
      assessCliModelAvailabilityFromCapabilities(
        {
          claude: {
            ...fallbackCliModelCapabilities('claude', '2026-05-08T00:00:00.000Z'),
            source: 'catalog',
          },
        },
        'claude',
        'missing-claude',
      ).message,
    ).toContain('installed CLI catalog. Update Claude CLI');
    expect(
      assessCliModelAvailabilityFromCapabilities({ codex: fallback }, 'codex', 'missing-codex')
        .message,
    ).toContain('available fallback presets. Update Codex CLI');
    expect(
      assessCliModelAvailabilityFromCapabilities(
        {
          gemini: {
            ...geminiFallback,
            source: 'unavailable',
          },
        },
        'gemini',
        'missing-gemini',
      ).message,
    ).toContain('installed CLI. Update Gemini CLI');
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
    expect(
      assessCliReasoningEffortAvailability(undefined, 'openrouter', 'openrouter/auto', 'xhigh'),
    ).toEqual({ available: true, message: null });
    expect(
      assessCliReasoningEffortAvailabilityFromCapabilities(
        { codex: fallback },
        'codex',
        null,
        'low',
      ),
    ).toEqual({ available: true, message: null });
    expect(
      assessCliReasoningEffortAvailabilityFromCapabilities(
        { codex: fallback },
        'codex',
        'gpt-5.5',
        'xhigh',
      ),
    ).toEqual({ available: true, message: null });
    expect(
      assessCliReasoningEffortAvailabilityFromCapabilities(
        { codex: fallback },
        'codex',
        'gpt-5.5',
        'none',
      ).message,
    ).toContain('Codex CLI does not report none effort');
    expect(
      assessCliReasoningEffortAvailabilityFromCapabilities(
        {
          claude: fallbackCliModelCapabilities('claude', '2026-05-08T00:00:00.000Z'),
        },
        'claude',
        null,
        'xhigh',
      ).message,
    ).toContain('Claude CLI does not report xhigh effort');
    expect(
      assessCliReasoningEffortAvailabilityFromCapabilities(
        { gemini: geminiFallback },
        'gemini',
        null,
        'xhigh',
      ).message,
    ).toContain('Gemini CLI does not report xhigh effort');
    expect(
      assessCliSelectionAvailabilityFromCapabilities(
        { codex: fallback },
        'codex',
        'missing',
        'low',
      ),
    ).toMatchObject({ available: false });
    expect(
      assessCliSelectionAvailabilityFromCapabilities(
        { codex: fallback },
        'codex',
        'gpt-5.5',
        'low',
      ),
    ).toEqual({ available: true, message: null });
  });
});
