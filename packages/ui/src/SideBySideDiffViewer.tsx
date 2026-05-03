'use client';

import { useMemo, useState } from 'react';
import type { DiffRecord } from './lib/shipcode';
import { cn } from './lib/utils';
import { Badge } from './primitives/badge';
import { Button } from './primitives/button';
import { useSyntaxHighlightedLines } from './SyntaxHighlightedCode';

interface SideBySideDiffViewerProps {
  diffs: DiffRecord[];
  className?: string;
}

type SideBySideLine = {
  type: 'context' | 'added' | 'removed' | 'hunk';
  leftNum: number | null;
  rightNum: number | null;
  leftText: string;
  rightText: string;
};

function parseSideBySideLines(diffContent: string): SideBySideLine[] {
  const rawLines = diffContent.split('\n');
  const result: SideBySideLine[] = [];
  let leftNum = 0;
  let rightNum = 0;

  // Buffer removed/added lines for paired rendering
  let removedBuffer: { num: number; text: string }[] = [];
  let addedBuffer: { num: number; text: string }[] = [];

  const flushBuffers = () => {
    const maxLen = Math.max(removedBuffer.length, addedBuffer.length);
    for (let i = 0; i < maxLen; i++) {
      const removed = removedBuffer[i];
      const added = addedBuffer[i];
      result.push({
        type: removed && added ? 'removed' : removed ? 'removed' : 'added',
        leftNum: removed?.num ?? null,
        rightNum: added?.num ?? null,
        leftText: removed?.text ?? '',
        rightText: added?.text ?? '',
      });
    }
    removedBuffer = [];
    addedBuffer = [];
  };

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      flushBuffers();
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        leftNum = Number.parseInt(match[1], 10) - 1;
        rightNum = Number.parseInt(match[2], 10) - 1;
      }
      result.push({
        type: 'hunk',
        leftNum: null,
        rightNum: null,
        leftText: line,
        rightText: line,
      });
      continue;
    }

    // Skip diff file headers
    if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('diff ') ||
      line.startsWith('index ')
    ) {
      continue;
    }

    if (line.startsWith('-')) {
      leftNum++;
      removedBuffer.push({ num: leftNum, text: line.slice(1) });
    } else if (line.startsWith('+')) {
      rightNum++;
      addedBuffer.push({ num: rightNum, text: line.slice(1) });
    } else {
      flushBuffers();
      leftNum++;
      rightNum++;
      result.push({
        type: 'context',
        leftNum,
        rightNum,
        leftText: line.startsWith(' ') ? line.slice(1) : line,
        rightText: line.startsWith(' ') ? line.slice(1) : line,
      });
    }
  }

  flushBuffers();
  return result;
}

const actionColor: Record<string, string> = {
  create: 'text-success',
  delete: 'text-danger',
  modify: 'text-warning',
  rename: 'text-accent',
};

const actionVariant: Record<string, 'success' | 'danger' | 'warning' | 'default'> = {
  create: 'success',
  delete: 'danger',
  modify: 'warning',
  rename: 'default',
};

const actionIcon: Record<string, string> = {
  create: '+',
  delete: '-',
  modify: '~',
  rename: '→',
};

export function SideBySideDiffViewer({ diffs, className }: SideBySideDiffViewerProps) {
  const [activeFile, setActiveFile] = useState<string>(diffs[0]?.filePath ?? '');

  const activeDiff = diffs.find((d) => d.filePath === activeFile) ?? diffs[0];

  const parsedLines = useMemo(
    () => (activeDiff?.diffContent ? parseSideBySideLines(activeDiff.diffContent) : []),
    [activeDiff?.diffContent],
  );
  const leftLines = useMemo(() => parsedLines.map((line) => line.leftText), [parsedLines]);
  const rightLines = useMemo(() => parsedLines.map((line) => line.rightText), [parsedLines]);
  const leftHighlightedLines = useSyntaxHighlightedLines(leftLines, activeDiff?.filePath);
  const rightHighlightedLines = useSyntaxHighlightedLines(rightLines, activeDiff?.filePath);

  if (diffs.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted text-sm">
        No changes to display
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* File tree sidebar + diff pane */}
      <div className="flex min-h-0 flex-1">
        {/* File list */}
        <div className="w-64 shrink-0 border-r border-border overflow-y-auto bg-secondary/30">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {diffs.length} file{diffs.length === 1 ? '' : 's'} changed
          </div>
          {diffs.map((diff) => (
            <Button
              type="button"
              variant="ghost"
              key={diff.id}
              aria-label={diff.filePath}
              title={diff.filePath}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-tertiary transition-colors',
                diff.filePath === activeDiff?.filePath && 'bg-tertiary text-primary',
                diff.filePath !== activeDiff?.filePath && 'text-secondary',
              )}
              onClick={() => setActiveFile(diff.filePath)}
            >
              <span className={cn('shrink-0 font-mono text-[11px]', actionColor[diff.action])}>
                {actionIcon[diff.action] ?? '~'}
              </span>
              <span className="truncate">{diff.filePath}</span>
            </Button>
          ))}
        </div>

        {/* Diff content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* File header */}
          {activeDiff && (
            <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2">
              <code className="text-xs text-primary">{activeDiff.filePath}</code>
              <Badge
                variant={actionVariant[activeDiff.action] ?? 'default'}
                className="text-[10px]"
              >
                {activeDiff.action}
              </Badge>
            </div>
          )}

          {/* Side-by-side lines */}
          <div className="flex-1 overflow-auto">
            {activeDiff?.diffContent ? (
              <table className="w-full border-collapse font-mono text-xs">
                <tbody>
                  {parsedLines.map((line, i) => {
                    if (line.type === 'hunk') {
                      return (
                        <tr
                          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have stable order
                          key={i}
                          className="bg-accent/5"
                        >
                          <td
                            colSpan={4}
                            className="px-3 py-1 text-accent text-[11px] font-semibold"
                          >
                            {line.leftText}
                          </td>
                        </tr>
                      );
                    }

                    const isRemoved = line.type === 'removed' || line.type === 'added';

                    return (
                      <tr
                        // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have stable order
                        key={i}
                      >
                        {/* Left side (old) */}
                        <td
                          className={cn(
                            'w-[1px] select-none whitespace-nowrap border-r border-border/50 px-2 py-0 text-right text-muted/50 text-[11px]',
                            line.leftNum !== null && line.rightNum === null && 'bg-danger/10',
                          )}
                        >
                          {line.leftNum}
                        </td>
                        <td
                          className={cn(
                            'whitespace-pre border-r border-border px-3 py-0',
                            line.leftNum !== null &&
                              line.rightNum === null &&
                              'bg-danger/10 text-danger',
                            line.type === 'context' && 'text-secondary',
                          )}
                        >
                          {line.leftText
                            ? leftHighlightedLines[i]
                            : line.leftNum === null && isRemoved
                              ? ''
                              : '\u00A0'}
                        </td>

                        {/* Right side (new) */}
                        <td
                          className={cn(
                            'w-[1px] select-none whitespace-nowrap border-r border-border/50 px-2 py-0 text-right text-muted/50 text-[11px]',
                            line.rightNum !== null && line.leftNum === null && 'bg-success/10',
                          )}
                        >
                          {line.rightNum}
                        </td>
                        <td
                          className={cn(
                            'whitespace-pre px-3 py-0',
                            line.rightNum !== null &&
                              line.leftNum === null &&
                              'bg-success/10 text-success',
                            line.type === 'context' && 'text-secondary',
                          )}
                        >
                          {line.rightText
                            ? rightHighlightedLines[i]
                            : line.rightNum === null && isRemoved
                              ? ''
                              : '\u00A0'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="flex items-center justify-center h-32 text-sm text-muted">
                No diff content available for this file
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
