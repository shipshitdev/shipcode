'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  type HighlightToken,
  keyedLines,
  languageFromFilePath,
  normalizeLanguage,
  renderTokenSpans,
  useHighlightedTokens,
} from '@/syntax-highlighting';

export interface SyntaxHighlightedCodeProps {
  code: string;
  filePath?: string;
  language?: string;
  className?: string;
}

export interface SyntaxHighlightedLineProps {
  code: string;
  filePath?: string;
  language?: string;
  className?: string;
}

function TokenSpans({
  tokens,
  fallback,
}: {
  tokens: HighlightToken[] | undefined;
  fallback: string;
}) {
  return renderTokenSpans(tokens, fallback);
}

export function SyntaxHighlightedCode({
  code,
  filePath,
  language,
  className,
}: SyntaxHighlightedCodeProps) {
  const resolvedLanguage = useMemo(
    () => (language ? normalizeLanguage(language) : languageFromFilePath(filePath)),
    [filePath, language],
  );
  const tokens = useHighlightedTokens(code, resolvedLanguage);
  const lines = useMemo(() => code.split('\n'), [code]);
  const stableLines = useMemo(() => keyedLines(lines), [lines]);

  return (
    <pre
      className={cn('whitespace-pre font-mono text-[11px] leading-[1.45] text-primary', className)}
    >
      {stableLines.map(({ key, line }, index) => (
        <div key={key}>
          <TokenSpans tokens={tokens?.[index]} fallback={line} />
        </div>
      ))}
    </pre>
  );
}

export function SyntaxHighlightedLine({
  code,
  filePath,
  language,
  className,
}: SyntaxHighlightedLineProps) {
  const resolvedLanguage = useMemo(
    () => (language ? normalizeLanguage(language) : languageFromFilePath(filePath)),
    [filePath, language],
  );
  const tokens = useHighlightedTokens(code, resolvedLanguage);

  return (
    <span className={className}>
      <TokenSpans tokens={tokens?.[0]} fallback={code} />
    </span>
  );
}
