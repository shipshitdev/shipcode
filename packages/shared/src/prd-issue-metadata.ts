const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/;

export const PRD_COMPLEXITY_LABEL_PREFIX = 'complexity:';
export const PRD_BLAST_LABEL_PREFIX = 'blast:';

export const PRD_ESTIMATED_COMPLEXITIES = ['low', 'medium', 'high'] as const;
export type PrdEstimatedComplexity = (typeof PRD_ESTIMATED_COMPLEXITIES)[number];

export const PRD_BLAST_RADII = ['contained', 'cross-package', 'cross-app', 'infra'] as const;
export type PrdBlastRadius = (typeof PRD_BLAST_RADII)[number];

export const PRD_MANAGED_LABEL_PREFIXES = [
  PRD_COMPLEXITY_LABEL_PREFIX,
  PRD_BLAST_LABEL_PREFIX,
] as const;
export const PRD_MANAGED_DISCRETE_LABELS = ['enhancement'] as const;

export interface ParsedPrdFrontmatter {
  name?: string;
  description?: string;
  status?: string;
  estimated_complexity?: string;
  blast_radius?: string;
}

export interface PrdIssueMetadata {
  cleanBody: string;
  frontmatter: ParsedPrdFrontmatter;
  estimatedComplexity: PrdEstimatedComplexity;
  blastRadius: PrdBlastRadius;
}

function normalizeDiscreteValue<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  transform?: (normalized: string) => string,
): T | null {
  if (!value) return null;
  const normalized = (transform ? transform(value) : value.trim().toLowerCase()) as T;
  return allowed.includes(normalized) ? normalized : null;
}

function normalizeComplexity(value: string | null | undefined): PrdEstimatedComplexity | null {
  return normalizeDiscreteValue(value, PRD_ESTIMATED_COMPLEXITIES);
}

function normalizeBlastRadius(value: string | null | undefined): PrdBlastRadius | null {
  return normalizeDiscreteValue(value, PRD_BLAST_RADII, (raw) =>
    raw.trim().toLowerCase().replaceAll('_', '-'),
  );
}

function parseFrontmatter(raw: string): ParsedPrdFrontmatter {
  const frontmatter: ParsedPrdFrontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) continue;
    frontmatter[key as keyof ParsedPrdFrontmatter] = value;
  }
  return frontmatter;
}

function readManagedLabelValue(labels: string[], prefix: string): string | null {
  const match = labels.find((label) => label.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

export function stripPrdFrontmatter(body: string): string {
  const match = body.match(FRONTMATTER_PATTERN);
  if (!match) return body;
  return body.slice(match[0].length).replace(/^\r?\n+/, '');
}

export function splitPrdFrontmatter(body: string): {
  frontmatter: ParsedPrdFrontmatter;
  cleanBody: string;
} {
  const match = body.match(FRONTMATTER_PATTERN);
  if (!match) return { frontmatter: {}, cleanBody: body };
  return {
    frontmatter: parseFrontmatter(match[1] ?? ''),
    cleanBody: body.slice(match[0].length).replace(/^\r?\n+/, ''),
  };
}

export function readPrdIssueMetadata(body: string, labels: string[] = []): PrdIssueMetadata {
  const { frontmatter, cleanBody } = splitPrdFrontmatter(body);
  const estimatedComplexity =
    normalizeComplexity(readManagedLabelValue(labels, PRD_COMPLEXITY_LABEL_PREFIX)) ??
    normalizeComplexity(frontmatter.estimated_complexity) ??
    'medium';
  const blastRadius =
    normalizeBlastRadius(readManagedLabelValue(labels, PRD_BLAST_LABEL_PREFIX)) ??
    normalizeBlastRadius(frontmatter.blast_radius) ??
    'contained';

  return {
    cleanBody,
    frontmatter,
    estimatedComplexity,
    blastRadius,
  };
}
