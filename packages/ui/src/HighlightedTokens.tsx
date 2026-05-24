'use client';

import type { HighlightToken } from '@/syntax-highlighting';
import { renderTokenSpans } from '@/syntax-token-rendering';

export function HighlightedTokens({
  tokens,
  fallback,
}: {
  tokens: HighlightToken[] | undefined;
  fallback: string;
}) {
  return renderTokenSpans(tokens, fallback);
}
