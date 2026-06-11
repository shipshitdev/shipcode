import { describe, expect, it } from 'vitest';
import {
  buildPrdMetadataLabels,
  PRD_BLAST_LABEL_PREFIX,
  PRD_COMPLEXITY_LABEL_PREFIX,
  PRD_METADATA_MAPPING,
  readPrdIssueMetadata,
  splitPrdFrontmatter,
  stripPrdFrontmatter,
} from './prd-issue-metadata';

describe('buildPrdMetadataLabels', () => {
  it('projects complexity and blast radius onto native label strings', () => {
    expect(buildPrdMetadataLabels('high', 'infra')).toEqual(['complexity:high', 'blast:infra']);
    expect(buildPrdMetadataLabels('low', 'contained')).toEqual([
      'complexity:low',
      'blast:contained',
    ]);
  });

  it('round-trips through readPrdIssueMetadata via native labels', () => {
    const labels = buildPrdMetadataLabels('medium', 'cross-package');
    const meta = readPrdIssueMetadata('Just the prose.', labels);
    expect(meta.estimatedComplexity).toBe('medium');
    expect(meta.blastRadius).toBe('cross-package');
  });
});

describe('PRD_METADATA_MAPPING', () => {
  it('maps complexity and blast radius to native labels with the right prefixes', () => {
    const byField = new Map(PRD_METADATA_MAPPING.map((m) => [m.field, m]));
    expect(byField.get('estimatedComplexity')).toMatchObject({
      target: 'native-label',
      labelPrefix: PRD_COMPLEXITY_LABEL_PREFIX,
    });
    expect(byField.get('blastRadius')).toMatchObject({
      target: 'native-label',
      labelPrefix: PRD_BLAST_LABEL_PREFIX,
    });
  });

  it('maps milestone and assignees to native fields and project facets to project fields', () => {
    const byField = new Map(PRD_METADATA_MAPPING.map((m) => [m.field, m.target]));
    expect(byField.get('milestone')).toBe('native-field');
    expect(byField.get('assignees')).toBe('native-field');
    expect(byField.get('issueType')).toBe('project-field');
    expect(byField.get('priority')).toBe('project-field');
  });
});

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

  it('skips malformed and empty frontmatter keys', () => {
    const raw = `---
name: demo
missing-separator
: ignored
description: value: with colon
---

# PRD`;

    expect(splitPrdFrontmatter(raw)).toEqual({
      frontmatter: {
        name: 'demo',
        description: 'value: with colon',
      },
      cleanBody: '# PRD',
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

  it('returns the original body when frontmatter is absent', () => {
    expect(stripPrdFrontmatter('# PRD: no-frontmatter')).toBe('# PRD: no-frontmatter');
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

  it('normalizes mixed-case metadata values before applying defaults', () => {
    const raw = `---
estimated_complexity:  HIGH
blast_radius: Cross_App
---

# PRD: example`;

    expect(readPrdIssueMetadata(raw)).toEqual({
      cleanBody: '# PRD: example',
      frontmatter: {
        estimated_complexity: 'HIGH',
        blast_radius: 'Cross_App',
      },
      estimatedComplexity: 'high',
      blastRadius: 'cross-app',
    });
  });

  it('ignores unknown managed label and frontmatter values', () => {
    const raw = `---
estimated_complexity: massive
blast_radius: everywhere
---

# PRD: example`;

    expect(readPrdIssueMetadata(raw, ['complexity:unknown', 'blast:unknown'])).toEqual({
      cleanBody: '# PRD: example',
      frontmatter: {
        estimated_complexity: 'massive',
        blast_radius: 'everywhere',
      },
      estimatedComplexity: 'medium',
      blastRadius: 'contained',
    });
  });
});
