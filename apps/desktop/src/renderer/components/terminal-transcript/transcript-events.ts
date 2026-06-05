import type { TerminalEventRecord } from '@shipcode/shared';
import { stripAnsi } from '@shipcode/shared';

export const DEFAULT_VISIBLE_EVENT_LIMIT = 300;
export const DEFAULT_WORKLOG_VISIBLE = 6;

const ERROR_LINE_RE = /(^|\s)(error|fatal|panic|exception|traceback|posix_spawnp failed)\b/i;
const EXIT_NONZERO_RE = /\bexit(?:ed)?[^\d]+(?:code\s*)?([1-9]\d*)\b/i;
const WARNING_LINE_RE = /(^|\s)(warn(?:ing)?|deprecat(?:ed|ion))\b/i;

export type ConsoleSeverity = 'error' | 'warning' | 'info';

export function classifyConsoleLine(content: string): ConsoleSeverity {
  if (ERROR_LINE_RE.test(content)) return 'error';
  if (EXIT_NONZERO_RE.test(content)) return 'error';
  if (WARNING_LINE_RE.test(content)) return 'warning';
  return 'info';
}

export type ToolCategory = 'bash' | 'file' | 'search' | 'default';

export function toolCategory(name: string): ToolCategory {
  if (name === 'Bash') return 'bash';
  if (name === 'Read' || name === 'Write' || name === 'Edit') return 'file';
  if (name === 'Glob' || name === 'Grep') return 'search';
  return 'default';
}

export const TOOL_BADGE_CLASSES: Record<ToolCategory, string> = {
  bash: 'border border-sky-500/25 bg-sky-500/15 text-sky-400',
  file: 'border border-emerald-500/25 bg-emerald-500/15 text-emerald-400',
  search: 'border border-violet-500/25 bg-violet-500/15 text-violet-400',
  default: 'border border-border/50 bg-secondary/60 text-muted-foreground',
};

export type TranscriptSegment =
  | { type: 'single'; record: TerminalEventRecord }
  | { type: 'worklog'; records: TerminalEventRecord[] };

function isWorkEvent(record: TerminalEventRecord): boolean {
  const e = record.event;
  if (e.kind === 'tool_start') return true;
  if (e.kind === 'tool_end') {
    return typeof e.exitCode !== 'number' || e.exitCode === 0;
  }
  if (e.kind === 'lifecycle') return classifyConsoleLine(stripAnsi(e.message)) === 'info';
  if (e.kind === 'raw') return classifyConsoleLine(stripAnsi(e.content)) === 'info';
  return false;
}

export function groupTranscriptEvents(events: TerminalEventRecord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let currentGroup: TerminalEventRecord[] = [];

  for (const record of events) {
    if (isWorkEvent(record)) {
      currentGroup.push(record);
    } else {
      if (currentGroup.length > 0) {
        segments.push({ type: 'worklog', records: currentGroup });
        currentGroup = [];
      }
      segments.push({ type: 'single', record });
    }
  }
  if (currentGroup.length > 0) {
    segments.push({ type: 'worklog', records: currentGroup });
  }
  return segments;
}

export function workLogRowLabel(record: TerminalEventRecord): string {
  const e = record.event;
  if (e.kind === 'tool_start') {
    if (e.name === 'Bash') return 'Command run';
    if (e.name === 'Read') return 'File read';
    if (e.name === 'Write' || e.name === 'Edit') return 'File change';
    if (e.name === 'Grep' || e.name === 'Glob') return 'Search';
    return e.name;
  }
  if (e.kind === 'tool_end') {
    const dur = typeof e.durationMs === 'number' ? ` (${(e.durationMs / 1000).toFixed(1)}s)` : '';
    return `Completed${dur}`;
  }
  if (e.kind === 'lifecycle') return stripAnsi(e.message);
  if (e.kind === 'raw') return stripAnsi(e.content);
  return '';
}

export function workLogRowDetail(record: TerminalEventRecord): string {
  const e = record.event;
  if (e.kind === 'tool_start') {
    const detail = e.command ?? e.filePath ?? e.pattern ?? stripAnsi(e.summary);
    return `${e.name}: ${detail}`;
  }
  if (e.kind === 'tool_end') return e.name;
  return '';
}

export type WorkLogItem =
  | { type: 'single'; record: TerminalEventRecord }
  | { type: 'pair'; start: TerminalEventRecord; end: TerminalEventRecord };

export function consolidateToolPairs(records: TerminalEventRecord[]): WorkLogItem[] {
  const items: WorkLogItem[] = [];
  let i = 0;
  while (i < records.length) {
    const cur = records[i];
    const next = records[i + 1];
    if (
      cur.event.kind === 'tool_start' &&
      next?.event.kind === 'tool_end' &&
      next.event.name === cur.event.name
    ) {
      items.push({ type: 'pair', start: cur, end: next });
      i += 2;
    } else {
      items.push({ type: 'single', record: cur });
      i += 1;
    }
  }
  return items;
}

export function formatTokens(
  usage: { prompt: number; completion: number } | undefined,
  costUsd?: number,
): string {
  const parts: string[] = [];
  if (usage) parts.push(`${usage.prompt}+${usage.completion} tok`);
  if (typeof costUsd === 'number' && costUsd > 0) parts.push(`$${costUsd.toFixed(4)}`);
  return parts.join(' · ');
}

export function dedupeTranscriptEvents(events: TerminalEventRecord[]): TerminalEventRecord[] {
  const seen = new Set<string>();
  let hasDuplicate = false;
  for (const event of events) {
    if (seen.has(event.id)) {
      hasDuplicate = true;
      break;
    }
    seen.add(event.id);
  }
  if (!hasDuplicate) return events;
  return Array.from(new Map(events.map((record) => [record.id, record])).values());
}
