import { describe, expect, it } from 'vitest';
import {
  buildPrdMetadataLabels,
  readPrdIssueMetadata,
  splitPrdFrontmatter,
  stripPrdFrontmatter,
} from './prd-issue-metadata';

describe('splitPrdFrontmatter', () => {
  it('extracts frontmatter and strips it from the body', () => {
    const raw = `---
name: demo-pipeline-hello
description: Trivial hello-world utility
status: backlog
estimated_complexity: low
blast_radius: contained
---

# PRD: demo-pipeline-hello

## Executive Summary
Demo`;

    expect(splitPrdFrontmatter(raw)).toEqual({
      frontmatter: {
        name: 'demo-pipeline-hello',
        description: 'Trivial hello-world utility',
        status: 'backlog',
        estimated_complexity: 'low',
        blast_radius: 'contained',
      },
      cleanBody: '# PRD: demo-pipeline-hello\n\n## Executive Summary\nDemo',
    });
  });

  it('returns the original body when no frontmatter exists', () => {
    expect(splitPrdFrontmatter('# PRD: x')).toEqual({
      frontmatter: {},
      cleanBody: '# PRD: x',
    });
  });
});

describe('stripPrdFrontmatter', () => {
  it('removes only the leading frontmatter block', () => {
    const raw = `---
name: hello
---

## Executive Summary
Hi`;

    expect(stripPrdFrontmatter(raw)).toBe('## Executive Summary\nHi');
  });
});

describe('readPrdIssueMetadata', () => {
  it('reads metadata from frontmatter for legacy PRDs', () => {
    const raw = `---
estimated_complexity: low
blast_radius: cross_app
---

# PRD: example`;

    expect(readPrdIssueMetadata(raw)).toEqual({
      cleanBody: '# PRD: example',
      frontmatter: {
        estimated_complexity: 'low',
        blast_radius: 'cross_app',
      },
      estimatedComplexity: 'low',
      blastRadius: 'cross-app',
    });
  });

  it('prefers native labels over legacy frontmatter when both exist', () => {
    const raw = `---
estimated_complexity: low
blast_radius: contained
---

# PRD: example`;

    expect(readPrdIssueMetadata(raw, ['enhancement', 'complexity:high', 'blast:infra'])).toEqual({
      cleanBody: '# PRD: example',
      frontmatter: {
        estimated_complexity: 'low',
        blast_radius: 'contained',
      },
      estimatedComplexity: 'high',
      blastRadius: 'infra',
    });
  });

  it('falls back to medium / contained when no metadata is present', () => {
    expect(readPrdIssueMetadata('# PRD: example')).toEqual({
      cleanBody: '# PRD: example',
      frontmatter: {},
      estimatedComplexity: 'medium',
      blastRadius: 'contained',
    });
  });
});

describe('buildPrdMetadataLabels', () => {
  it('builds the managed complexity and blast labels', () => {
    expect(
      buildPrdMetadataLabels({ estimatedComplexity: 'high', blastRadius: 'cross-app' }),
    ).toEqual(['complexity:high', 'blast:cross-app']);
  });
});
