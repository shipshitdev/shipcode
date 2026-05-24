import type { CSSProperties, ReactNode } from 'react';
import type { HighlightToken } from '@/syntax-highlighting';

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
