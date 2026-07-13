import type { PipelinePhaseLogRecord } from '@shipcode/shared';

/** Literal first line used to find and update the existing timeline comment. */
export const PIPELINE_TIMELINE_COMMENT_MARKER = '## ShipCode Pipeline Timeline';

const TERMINAL_PHASES = new Set(['completed', 'failed', 'paused']);

export function formatPipelineTimelineComment(entries: PipelinePhaseLogRecord[]): string {
  const timeline = dedupeConsecutivePhases(entries);
  const lines = [PIPELINE_TIMELINE_COMMENT_MARKER, ''];

  for (const [index, entry] of timeline.entries()) {
    const isCurrent = index === timeline.length - 1 && !TERMINAL_PHASES.has(entry.phase);
    const detail = entry.phase === 'failed' ? formatError(entry.errorMessage) : '';
    lines.push(
      `- ${phaseGlyph(entry.phase, isCurrent)} **${formatPhase(entry.phase)}** — ${formatTimestamp(entry.startedAt)}${detail}`,
    );
  }

  lines.push('', '---', '*Updated by ShipCode*');
  return lines.join('\n');
}

function dedupeConsecutivePhases(entries: PipelinePhaseLogRecord[]): PipelinePhaseLogRecord[] {
  const result: PipelinePhaseLogRecord[] = [];
  for (const entry of entries) {
    if (result.at(-1)?.phase === entry.phase) {
      result[result.length - 1] = entry;
    } else {
      result.push(entry);
    }
  }
  return result;
}

function phaseGlyph(phase: PipelinePhaseLogRecord['phase'], isCurrent: boolean): string {
  if (phase === 'failed') return '❌';
  if (phase === 'paused') return '⏸️';
  if (isCurrent) return '▶️';
  return '✅';
}

function formatPhase(phase: PipelinePhaseLogRecord['phase']): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function formatError(error: string | null): string {
  if (!error) return '';
  const firstLine = error.split(/\r?\n/, 1)[0]?.trim().slice(0, 280) ?? '';
  if (!firstLine) return '';
  const escaped = firstLine
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return ` — <code>${escaped}</code>`;
}
