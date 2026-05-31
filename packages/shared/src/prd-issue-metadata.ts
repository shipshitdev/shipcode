const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/;

export const PRD_COMPLEXITY_LABEL_PREFIX = 'complexity:';
export const PRD_BLAST_LABEL_PREFIX = 'blast:';

export const PRD_ESTIMATED_COMPLEXITIES = ['low', 'medium', 'high'] as const;
export type PrdEstimatedComplexity = (typeof PRD_ESTIMATED_COMPLEXITIES)[number];

export const PRD_BLAST_RADII = ['contained', 'cross-package', 'cross-app', 'infra'] as const;
export type PrdBlastRadius = (typeof PRD_BLAST_RADII)[number];

export const PRD_METADATA_LABELS = [
  {
    name: 'complexity:low',
    color: '0e8a16',
    description: 'PRD estimated complexity: low.',
  },
  {
    name: 'complexity:medium',
    color: 'fbca04',
    description: 'PRD estimated complexity: medium.',
  },
  {
    name: 'complexity:high',
    color: 'd93f0b',
    description: 'PRD estimated complexity: high.',
  },
  {
    name: 'blast:contained',
    color: '1f883d',
    description: 'PRD blast radius: contained.',
  },
  {
    name: 'blast:cross-package',
    color: '0969da',
    description: 'PRD blast radius: cross-package.',
  },
  {
    name: 'blast:cross-app',
    color: '8250df',
    description: 'PRD blast radius: cross-app.',
  },
  {
    name: 'blast:infra',
    color: 'cf222e',
    description: 'PRD blast radius: infrastructure.',
  },
] as const;

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
    frontmatter: parseFrontmatter(match[1] as string),
    cleanBody: body.slice(match[0].length).replace(/^\r?\n+/, ''),
  };
}

export type PrdMetadataTarget = 'native-label' | 'native-field' | 'project-field';

export interface PrdMetadataFieldMapping {
  /** The PRD/task metadata field. */
  field:
    | 'estimatedComplexity'
    | 'blastRadius'
    | 'issueType'
    | 'status'
    | 'priority'
    | 'milestone'
    | 'assignees';
  /** Where the value is projected on GitHub. */
  target: PrdMetadataTarget;
  /** For `native-label` targets, the label prefix used (e.g. `complexity:`). */
  labelPrefix?: string;
}

/**
 * Authoritative map of which PRD/task metadata projects onto which GitHub
 * surface (AC1 of #45):
 * - `native-label`  — a `prefix:value` label on the issue itself
 * - `native-field`  — a first-class issue field set via `gh issue` flags
 *                     (milestone, assignees)
 * - `project-field` — a Projects v2 single-select field
 *
 * Keeps the projection sites (gh-cli, IPC handlers) honest about where each
 * field is meant to live and removes the old reliance on body frontmatter.
 */
export const PRD_METADATA_MAPPING: readonly PrdMetadataFieldMapping[] = [
  {
    field: 'estimatedComplexity',
    target: 'native-label',
    labelPrefix: PRD_COMPLEXITY_LABEL_PREFIX,
  },
  { field: 'blastRadius', target: 'native-label', labelPrefix: PRD_BLAST_LABEL_PREFIX },
  { field: 'issueType', target: 'project-field' },
  { field: 'status', target: 'project-field' },
  { field: 'priority', target: 'project-field' },
  { field: 'milestone', target: 'native-field' },
  { field: 'assignees', target: 'native-field' },
] as const;

/**
 * Build the native issue labels that project a PRD's complexity + blast radius
 * onto the issue itself (e.g. `complexity:medium`, `blast:contained`). Written
 * on create and kept in sync on edit so the metadata survives even for repos
 * without a configured Projects v2 board — previously these values only ever
 * reached the board fields and vanished for boardless projects.
 */
export function buildPrdMetadataLabels(
  estimatedComplexity: PrdEstimatedComplexity,
  blastRadius: PrdBlastRadius,
): string[] {
  return [
    `${PRD_COMPLEXITY_LABEL_PREFIX}${estimatedComplexity}`,
    `${PRD_BLAST_LABEL_PREFIX}${blastRadius}`,
  ];
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
