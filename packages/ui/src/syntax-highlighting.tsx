'use client';

import { type CSSProperties, type ReactNode, useEffect, useMemo, useReducer } from 'react';
import {
  type BundledLanguage,
  createHighlighter,
  createJavaScriptRegexEngine,
  type Highlighter,
  type ThemedToken,
} from 'shiki';

export type HighlightToken = ThemedToken;

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

export function normalizeLanguage(value: string): BundledLanguage {
  const key = value.toLowerCase();
  if (key === 'ts') return 'typescript';
  if (key === 'js') return 'javascript';
  if (key === 'md') return 'markdown';
  return (LANGUAGE_BY_EXTENSION[key] ?? key) as BundledLanguage;
}

export function languageFromFilePath(filePath: string | undefined): BundledLanguage | 'text' {
  if (!filePath) return 'text';
  const name = filePath.split('/').pop()?.toLowerCase() ?? '';
  const exact = LANGUAGE_BY_FILENAME[name];
  if (exact) return exact;
  const extension = name.includes('.') ? name.split('.').pop() : null;
  return extension ? (LANGUAGE_BY_EXTENSION[extension] ?? 'text') : 'text';
}

export function useHighlightedTokens(
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

export function keyedLines(lines: string[]) {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const occurrence = seen.get(line) ?? 0;
    seen.set(line, occurrence + 1);
    return { key: `${occurrence}:${line}`, line };
  });
}

export function renderTokenSpans(
  tokens: HighlightToken[] | undefined,
  fallback: string,
): ReactNode {
  if (!tokens) return fallback || '\u00A0';
  if (tokens.length === 0) return '\u00A0';
  return keyedTokens(tokens).map(({ key, token }) => (
    <span key={key} style={tokenStyle(token)}>
      {token.content}
    </span>
  ));
}

export function useSyntaxHighlightedLines(lines: string[], filePath?: string): ReactNode[] {
  const code = lines.join('\n');
  const language = useMemo(() => languageFromFilePath(filePath), [filePath]);
  const tokens = useHighlightedTokens(code, language);

  return useMemo(
    () =>
      keyedLines(lines).map(({ key, line }, index) => (
        <span key={key}>{renderTokenSpans(tokens?.[index], line)}</span>
      )),
    [lines, tokens],
  );
}
