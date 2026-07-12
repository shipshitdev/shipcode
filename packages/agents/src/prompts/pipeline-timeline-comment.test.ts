import type { PipelinePhaseLogRecord } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import {
  formatPipelineTimelineComment,
  PIPELINE_TIMELINE_COMMENT_MARKER,
} from './pipeline-timeline-comment';

function entry(
  phase: PipelinePhaseLogRecord['phase'],
  startedAt: string,
  errorMessage: string | null = null,
): PipelinePhaseLogRecord {
  return {
    id: `${phase}-${startedAt}`,
    threadId: 'thread-1',
    runId: 'run-1',
    phase,
    startedAt,
    completedAt: null,
    durationMs: null,
    terminalStatus: null,
    errorMessage,
    metadata: null,
  };
}

describe('formatPipelineTimelineComment', () => {
  it('renders the marker, ordered phases, timestamps, and current glyph', () => {
    const body = formatPipelineTimelineComment([
      entry('planning', '2026-07-12T10:00:00.000Z'),
      entry('reviewing', '2026-07-12T10:05:00.000Z'),
      entry('executing', '2026-07-12T10:10:00.000Z'),
    ]);

    expect(body.split('\n')[0]).toBe(PIPELINE_TIMELINE_COMMENT_MARKER);
    expect(body).toContain('- ✅ **Planning** — 2026-07-12 10:00 UTC');
    expect(body).toContain('- ✅ **Reviewing** — 2026-07-12 10:05 UTC');
    expect(body).toContain('- ▶️ **Executing** — 2026-07-12 10:10 UTC');
    expect(body.indexOf('Planning')).toBeLessThan(body.indexOf('Reviewing'));
  });

  it('deduplicates consecutive phases and renders terminal glyphs with clamped errors', () => {
    const body = formatPipelineTimelineComment([
      entry('planning', '2026-07-12T10:00:00.000Z'),
      entry('planning', '2026-07-12T10:01:00.000Z'),
      entry('paused', '2026-07-12T10:02:00.000Z'),
      entry('failed', '2026-07-12T10:03:00.000Z', `<failure>${'x'.repeat(400)}\nignored`),
    ]);

    expect(body.match(/\*\*Planning\*\*/g)).toHaveLength(1);
    expect(body).toContain('Planning** — 2026-07-12 10:01 UTC');
    expect(body).toContain('⏸️ **Paused**');
    expect(body).toContain('❌ **Failed**');
    expect(body).toContain('<code>&lt;failure&gt;');
    expect(body).not.toContain('ignored');
    expect(body).not.toContain('x'.repeat(300));
  });
});
