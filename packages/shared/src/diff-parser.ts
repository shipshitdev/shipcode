import type { DiffRecord } from './types';

export type ParsedUnifiedDiff = Pick<
  DiffRecord,
  'filePath' | 'action' | 'diffContent' | 'beforeHash' | 'afterHash'
>;

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const unquoted = stripQuotes(value.trim());
  if (unquoted === '/dev/null') return null;
  if (unquoted.startsWith('a/') || unquoted.startsWith('b/')) {
    return unquoted.slice(2);
  }
  return unquoted;
}

function parseGitHeader(line: string): { beforePath: string | null; afterPath: string | null } {
  const match = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
  if (!match) {
    return { beforePath: null, afterPath: null };
  }
  return {
    beforePath: normalizePath(`a/${match[1]}`),
    afterPath: normalizePath(`b/${match[2]}`),
  };
}

export function parseUnifiedDiff(diff: string): ParsedUnifiedDiff[] {
  const normalized = diff.trim();
  if (!normalized) return [];

  const sections = normalized
    .split(/^diff --git /m)
    .map((section, index) => (index === 0 ? section : `diff --git ${section}`))
    .filter((section) => section.trim().startsWith('diff --git '));

  return sections.map((section) => {
    const lines = section.split('\n');
    const header = parseGitHeader(lines[0] ?? '');

    let action: ParsedUnifiedDiff['action'] = 'modify';
    let beforePath = header.beforePath;
    let afterPath = header.afterPath;
    let beforeHash: string | null = null;
    let afterHash: string | null = null;

    for (const line of lines) {
      if (line.startsWith('new file mode ')) {
        action = 'create';
        continue;
      }
      if (line.startsWith('deleted file mode ')) {
        action = 'delete';
        continue;
      }
      if (line.startsWith('rename from ')) {
        action = 'rename';
        beforePath = normalizePath(line.slice('rename from '.length));
        continue;
      }
      if (line.startsWith('rename to ')) {
        action = 'rename';
        afterPath = normalizePath(line.slice('rename to '.length));
        continue;
      }
      if (line.startsWith('index ')) {
        const match = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/i.exec(line);
        if (match) {
          beforeHash = match[1];
          afterHash = match[2];
        }
        continue;
      }
      if (line.startsWith('--- ')) {
        beforePath = normalizePath(line.slice(4));
        continue;
      }
      if (line.startsWith('+++ ')) {
        afterPath = normalizePath(line.slice(4));
      }
    }

    const filePath =
      action === 'delete'
        ? (beforePath ?? afterPath ?? 'changes.patch')
        : (afterPath ?? beforePath ?? 'changes.patch');

    return {
      filePath,
      action,
      diffContent: section,
      beforeHash,
      afterHash,
    };
  });
}
