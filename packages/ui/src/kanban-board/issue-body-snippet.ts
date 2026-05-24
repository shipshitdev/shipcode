import type { GitHubIssueCacheRecord } from '@/lib/shipcode';
import { isAutomationIssue } from './utils';

function stripMarkdownForSnippet(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[\s>*-]*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAutomationGoal(body: string): string | null {
  const match = body.match(/^##\s+Goal\s*\n+([\s\S]*?)(?=^##\s+|\s*$)/im);
  return match?.[1]?.trim() || null;
}

export function issueBodySnippet(issue: GitHubIssueCacheRecord): string | null {
  if (!issue.body) return null;
  const source = isAutomationIssue(issue)
    ? extractAutomationGoal(issue.body) || issue.body
    : issue.body;
  return stripMarkdownForSnippet(source).slice(0, 200) || null;
}
