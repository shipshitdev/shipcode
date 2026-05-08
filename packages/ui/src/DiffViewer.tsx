import { diffActionVariant, fileActionColor, fileActionIcon } from '@/lib/file-action';
import type { DiffRecord } from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Badge } from '@/primitives/badge';
import { Button } from '@/primitives/button';
import { useSyntaxHighlightedLines } from '@/SyntaxHighlightedCode';

interface DiffViewerProps {
  diffs: DiffRecord[];
  activeFile?: string;
  onFileSelect?: (filePath: string) => void;
}

export function DiffViewer({ diffs, activeFile, onFileSelect }: DiffViewerProps) {
  const activeDiff = diffs.find((d) => d.filePath === activeFile) ?? diffs[0];
  const diffLines = activeDiff?.diffContent?.split('\n') ?? [];
  const codeLines = diffLines.map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) return line;
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) return line.slice(1);
    return line;
  });
  const highlightedLines = useSyntaxHighlightedLines(codeLines, activeDiff?.filePath);

  if (diffs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted">
        <p>No changes to display</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-0.5 p-2 border-b border-border overflow-x-auto">
        {diffs.map((diff) => (
          <Button
            variant="ghost"
            size="xs"
            key={diff.id}
            className={cn(
              'h-auto gap-1 px-2.5 py-1 text-xs font-normal text-secondary hover:bg-tertiary',
              diff.filePath === activeDiff?.filePath && 'bg-tertiary text-primary',
            )}
            onClick={() => onFileSelect?.(diff.filePath)}
          >
            <span className={fileActionColor(diff.action)}>{fileActionIcon(diff.action)}</span>
            {diff.filePath.split('/').pop()}
          </Button>
        ))}
      </div>

      {activeDiff && (
        <div className="p-2">
          <div className="flex justify-between px-3 py-1.5 bg-secondary rounded-t-md text-xs">
            <code>{activeDiff.filePath}</code>
            <Badge variant={diffActionVariant(activeDiff.action)}>{activeDiff.action}</Badge>
          </div>
          <pre className="font-mono text-xs leading-relaxed overflow-x-auto py-2 bg-secondary rounded-b-md">
            {activeDiff.diffContent
              ? diffLines.map((line, i) => {
                  const isAdded = line.startsWith('+') && !line.startsWith('+++');
                  const isRemoved = line.startsWith('-') && !line.startsWith('---');
                  const isHunk = line.startsWith('@@');
                  const prefix = isAdded ? '+' : isRemoved ? '-' : line.startsWith(' ') ? ' ' : '';

                  return (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have stable order; blank lines repeat so index is the only unique key
                      key={i}
                      className={cn(
                        'px-3',
                        isAdded && 'bg-success/15 text-success',
                        isRemoved && 'bg-danger/15 text-danger',
                        isHunk && 'text-accent font-semibold',
                      )}
                    >
                      {isAdded || isRemoved || line.startsWith(' ') ? (
                        <>
                          <span>{prefix}</span>
                          {highlightedLines[i]}
                        </>
                      ) : (
                        line
                      )}
                    </div>
                  );
                })
              : 'No diff content available'}
          </pre>
        </div>
      )}
    </div>
  );
}
