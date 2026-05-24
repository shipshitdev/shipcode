/**
 * Pure functions for extracting fenced shipcode-* JSON blocks from LLM
 * output text. Provider-agnostic: takes resolved text in, returns parsed
 * artifact + raw fenced representation out.
 *
 * Used by StreamParser (after CLI NDJSON resolution) and directly by the
 * pipeline runtime when it already has plain text in hand.
 */

import { clampTextBlock, MAX_PIPELINE_RAW_OUTPUT_CHARS } from '@shipcode/shared';
import { stripAnsi } from './cli-ndjson';

export interface ParseResult<T> {
  success: boolean;
  data: T | null;
  raw: string;
  error?: string;
}

export interface FencedSchema<T> {
  parse: (data: unknown) => T;
}

/**
 * Extract and validate the LAST occurrence of a ```tag fenced JSON block.
 * Falls back to a loose top-level JSON regex when no fence is present.
 *
 * Searching from the end matters: the planner prompt or repo context may
 * mention the fence tag earlier in the buffer; the model's actual answer
 * is almost always the last valid block.
 */
export function extractFencedBlock<T>(
  text: string,
  tag: string,
  schema: FencedSchema<T>,
): ParseResult<T> {
  const fenceMatches = findFencedBlocks(text, tag);
  let lastFenceError: string | undefined;
  for (let i = fenceMatches.length - 1; i >= 0; i--) {
    const match = fenceMatches[i];
    try {
      const parsedJson = JSON.parse(match[1].trim());
      const parsed = schema.parse(parsedJson);
      return {
        success: true,
        data: parsed,
        raw: formatFencedArtifact(tag, parsed),
      };
    } catch (e) {
      lastFenceError = `Parse error: ${e}`;
    }
  }

  if (fenceMatches.length > 0) {
    const lastFence = fenceMatches[fenceMatches.length - 1];
    return {
      success: false,
      data: null,
      raw: compactArtifact(lastFence[0]),
      error: lastFenceError as string,
    };
  }

  const jsonMatch = tryExtractJson(text);
  if (jsonMatch) {
    try {
      const parsed = schema.parse(JSON.parse(jsonMatch));
      return {
        success: true,
        data: parsed,
        raw: formatFencedArtifact(tag, parsed),
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        raw: compactArtifact(`\`\`\`${tag}\n${jsonMatch.trim()}\n\`\`\``),
        error: `JSON found but schema validation failed: ${e}`,
      };
    }
  }

  return {
    success: false,
    data: null,
    raw: compactArtifact(text),
    error: `No ${tag} fenced block found`,
  };
}

function findFencedBlocks(text: string, tag: string): RegExpMatchArray[] {
  // Require \n before the closing fence so that ``` inside JSON string
  // values don't terminate the match early.
  const fenceRegex = new RegExp(`\`\`\`${tag}[^\n]*\n([\\s\\S]*?)\n\`\`\``, 'gm');
  return Array.from(text.matchAll(fenceRegex));
}

function formatFencedArtifact(tag: string, data: unknown): string {
  return `\`\`\`${tag}\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

function compactArtifact(text: string): string {
  return clampTextBlock(text, MAX_PIPELINE_RAW_OUTPUT_CHARS);
}

function tryExtractJson(text: string): string | null {
  const clean = stripAnsi(text);
  const marker = clean.search(/"(?:objective|planId|criteriaResults)"/);
  if (marker === -1) return null;

  const start = clean.lastIndexOf('{', marker);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < clean.length; index++) {
    const char = clean[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return clean.slice(start, index + 1);
      }
    }
  }

  return null;
}
