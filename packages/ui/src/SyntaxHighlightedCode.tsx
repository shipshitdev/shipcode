'use client';

import { type CSSProperties, type ReactNode, useEffect, useMemo, useReducer } from 'react';
import {
  type BundledLanguage,
  createHighlighter,
  createJavaScriptRegexEngine,
  type Highlighter,
  type ThemedToken,
} from 'shiki';
import { cn } from '@/lib/utils';

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

const HIGHLIGHT_THEME = 'dark-plus';

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLanguagePromises = new Map<BundledLanguage, Promise<void>>();

type HighlightState = {
  tokens: HighlightToken[][] | null;
};

type HighlightAction =
  | { type: 'loading' }
  | { type: 'loaded'; tokens: HighlightToken[][] }
  | { type: 'failed' };

function highlightReducer(_state: HighlightState, action: HighlightAction): HighlightState {
  switch (action.type) {
    case 'loaded':
      return { tokens: action.tokens };
    case 'loading':
    case 'failed':
      return { tokens: null };
  }
}

function getSyntaxHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    langs: [],
    themes: [HIGHLIGHT_THEME],
  });

  return highlighterPromise;
}

async function loadLanguage(language: BundledLanguage): Promise<Highlighter> {
  const highlighter = await getSyntaxHighlighter();
  let loadedLanguagePromise = loadedLanguagePromises.get(language);

  if (!loadedLanguagePromise) {
    loadedLanguagePromise = highlighter.loadLanguage(language).then(() => undefined);
    loadedLanguagePromises.set(language, loadedLanguagePromise);
  }

  await loadedLanguagePromise;
  return highlighter;
}

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
  const [state, dispatch] = useReducer(highlightReducer, { tokens: null });

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'loading' });

    if (!code || language === 'text') {
      return () => {
        cancelled = true;
      };
    }

    loadLanguage(language)
      .then((highlighter) =>
        highlighter.codeToTokens(code, {
          lang: language,
          theme: HIGHLIGHT_THEME,
        }),
      )
      .then((result) => {
        if (!cancelled) {
          dispatch({ type: 'loaded', tokens: result.tokens });
        }
      })
      .catch((error) => {
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
          console.warn('Syntax highlighting failed', error);
        }
        if (!cancelled) {
          dispatch({ type: 'failed' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return state.tokens;
}

function tokenStyle(token: HighlightToken): CSSProperties {
  return {
    color: token.color,
    fontStyle: token.fontStyle && (token.fontStyle & 1) !== 0 ? 'italic' : undefined,
    fontWeight: token.fontStyle && (token.fontStyle & 2) !== 0 ? 600 : undefined,
    textDecoration: token.fontStyle && (token.fontStyle & 4) !== 0 ? 'underline' : undefined,
  };
}

function keyedTokens(tokens: HighlightToken[]) {
  let offset = 0;
  return tokens.map((token) => {
    const key = `${offset}:${token.content}`;
    offset += token.content.length;
    return { key, token };
  });
}

function keyedLines(lines: string[]) {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const occurrence = seen.get(line) ?? 0;
    seen.set(line, occurrence + 1);
    return { key: `${occurrence}:${line}`, line };
  });
}

function TokenSpans({
  tokens,
  fallback,
}: {
  tokens: HighlightToken[] | undefined;
  fallback: string;
}) {
  if (!tokens) return fallback || '\u00A0';
  if (tokens.length === 0) return '\u00A0';
  return keyedTokens(tokens).map(({ key, token }) => (
    <span key={key} style={tokenStyle(token)}>
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

export function useSyntaxHighlightedLines(lines: string[], filePath?: string): ReactNode[] {
  const code = lines.join('\n');
  const language = useMemo(() => languageFromFilePath(filePath), [filePath]);
  const tokens = useHighlightedTokens(code, language);

  return useMemo(
    () =>
      keyedLines(lines).map(({ key, line }, index) => (
        <TokenSpans key={key} tokens={tokens?.[index]} fallback={line} />
      )),
    [lines, tokens],
  );
}
