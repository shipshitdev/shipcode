'use client';

import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';
import { type BundledLanguage, codeToTokens, type ThemedToken } from 'shiki';
import { cn } from './lib/utils';

type HighlightToken = ThemedToken;

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

const LANGUAGE_BY_EXTENSION: Record<string, BundledLanguage> = {
  cjs: 'javascript',
  css: 'css',
  html: 'html',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'jsx',
  md: 'markdown',
  mdx: 'mdx',
  mjs: 'javascript',
  scss: 'scss',
  ts: 'typescript',
  tsx: 'tsx',
  yaml: 'yaml',
  yml: 'yaml',
};

const LANGUAGE_BY_FILENAME: Record<string, BundledLanguage> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
};

function normalizeLanguage(value: string | undefined): BundledLanguage | 'text' {
  if (!value) return 'text';
  const key = value.toLowerCase();
  if (key === 'ts') return 'typescript';
  if (key === 'js') return 'javascript';
  if (key === 'md') return 'markdown';
  return (LANGUAGE_BY_EXTENSION[key] ?? key) as BundledLanguage;
}

export function languageFromFilePath(filePath: string | undefined): BundledLanguage | 'text' {
  if (!filePath) return 'text';
  const name = (filePath.split('/').pop() ?? filePath).toLowerCase();
  const exact = LANGUAGE_BY_FILENAME[name];
  if (exact) return exact;
  const extension = name.includes('.') ? name.split('.').pop() : null;
  return extension ? (LANGUAGE_BY_EXTENSION[extension] ?? 'text') : 'text';
}

function useHighlightedTokens(
  code: string,
  language: BundledLanguage | 'text',
): HighlightToken[][] | null {
  const [tokens, setTokens] = useState<HighlightToken[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);

    if (!code || language === 'text') {
      return () => {
        cancelled = true;
      };
    }

    codeToTokens(code, {
      lang: language,
      theme: 'dark-plus',
    })
      .then((result) => {
        if (!cancelled) {
          setTokens(result.tokens);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokens(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return tokens;
}

function tokenStyle(token: HighlightToken): CSSProperties {
  return {
    color: token.color,
    fontStyle: token.fontStyle && (token.fontStyle & 1) !== 0 ? 'italic' : undefined,
    fontWeight: token.fontStyle && (token.fontStyle & 2) !== 0 ? 600 : undefined,
    textDecoration: token.fontStyle && (token.fontStyle & 4) !== 0 ? 'underline' : undefined,
  };
}

function renderLineTokens(tokens: HighlightToken[] | undefined, fallback: string) {
  if (!tokens) return fallback || '\u00A0';
  if (tokens.length === 0) return '\u00A0';
  return tokens.map((token, index) => (
    <span
      // biome-ignore lint/suspicious/noArrayIndexKey: token order is stable for a rendered line
      key={index}
      style={tokenStyle(token)}
    >
      {token.content}
    </span>
  ));
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

  return (
    <pre
      className={cn('whitespace-pre font-mono text-[11px] leading-[1.45] text-primary', className)}
    >
      {lines.map((line, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: code lines have stable order while content is static
          key={index}
        >
          {renderLineTokens(tokens?.[index], line)}
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

  return <span className={className}>{renderLineTokens(tokens?.[0], code)}</span>;
}

export function useSyntaxHighlightedLines(lines: string[], filePath?: string): ReactNode[] {
  const code = lines.join('\n');
  const language = useMemo(() => languageFromFilePath(filePath), [filePath]);
  const tokens = useHighlightedTokens(code, language);

  return useMemo(
    () => lines.map((line, index) => renderLineTokens(tokens?.[index], line)),
    [lines, tokens],
  );
}
