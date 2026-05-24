import { describe, expect, it, vi } from 'vitest';
import {
  buildQaStateGapMessage,
  extractFeatureQaState,
  QA_STATE_SECTION_HEADING,
} from './feature-qa-state';

const VALID_QA_JSON = JSON.stringify({
  featureId: 'issue-42',
  routes: ['/dashboard', '/dashboard/settings'],
  criticalFlows: [
    {
      name: 'toggle dark mode',
      steps: ['navigate to /dashboard/settings', 'click theme toggle', 'verify body class'],
      successCriteria: 'Body has class "dark"',
    },
  ],
  expectedStates: ['dark mode active', 'light mode active'],
  testDataAssumptions: ['user is logged in'],
  selectorReadiness: 'ready',
});

function buildPrd(qaSection?: string): string {
  const base = `# PRD: test-feature

## Executive Summary
Test feature.

## Problem Statement
Something broken.
`;
  if (!qaSection) return base;
  return `${base}\n${qaSection}`;
}

describe('extractFeatureQaState', () => {
  it('extracts valid QA state from fenced JSON block', () => {
    const body = buildPrd(`## QA State\n\n\`\`\`json\n${VALID_QA_JSON}\n\`\`\``);
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('present');
    expect(result.qaState).toBeDefined();
    expect(result.qaState?.featureId).toBe('issue-42');
    expect(result.qaState?.routes).toEqual(['/dashboard', '/dashboard/settings']);
    expect(result.qaState?.criticalFlows).toHaveLength(1);
    expect(result.qaState?.selectorReadiness).toBe('ready');
  });

  it('returns absent when no QA State section exists', () => {
    const body = buildPrd();
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('absent');
    expect(result.qaState).toBeNull();
    expect(result.reason).toContain('No ## QA State section');
  });

  it('returns invalid when section has no fenced block', () => {
    const body = buildPrd('## QA State\n\nJust some text here, no JSON.');
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('invalid');
    expect(result.qaState).toBeNull();
    expect(result.reason).toContain('no valid fenced JSON block');
  });

  it('returns invalid when the QA State heading has no body', () => {
    const result = extractFeatureQaState('## QA State');
    expect(result.status).toBe('invalid');
    expect(result.reason).toContain('no valid fenced JSON block');
  });

  it('returns invalid when JSON fails Zod validation', () => {
    const badJson = JSON.stringify({ featureId: '', routes: [] });
    const body = buildPrd(`## QA State\n\n\`\`\`json\n${badJson}\n\`\`\``);
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('invalid');
    expect(result.qaState).toBeNull();
    expect(result.reason).toContain('failed validation');
  });

  it('returns invalid when JSON is malformed', () => {
    const body = buildPrd('## QA State\n\n```json\n{ broken json }\n```');
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('invalid');
    expect(result.qaState).toBeNull();
    expect(result.reason).toContain('malformed JSON');
  });

  it('handles non-Error JSON parse failures', () => {
    const parse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'parser unavailable';
    });

    const result = extractFeatureQaState(buildPrd(`## QA State\n\n\`\`\`json\n{}\n\`\`\``));

    expect(result.status).toBe('invalid');
    expect(result.reason).toContain('parser unavailable');
    parse.mockRestore();
  });

  it('handles QA State at end of document (no next heading)', () => {
    const body = `## Problem\nSomething\n\n## QA State\n\n\`\`\`json\n${VALID_QA_JSON}\n\`\`\``;
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('present');
    expect(result.qaState?.featureId).toBe('issue-42');
  });

  it('handles QA State between other sections', () => {
    const body = `## Problem\nSomething\n\n## QA State\n\n\`\`\`json\n${VALID_QA_JSON}\n\`\`\`\n\n## Dependencies\nNone`;
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('present');
    expect(result.qaState?.featureId).toBe('issue-42');
  });

  it('is case-insensitive for section heading', () => {
    const body = buildPrd(`## qa state\n\n\`\`\`json\n${VALID_QA_JSON}\n\`\`\``);
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('present');
  });

  it('ignores QA State text that is not a section heading', () => {
    const body = buildPrd(
      `This paragraph mentions ## QA State inline.\n\n## QA State\n\n\`\`\`json\n${VALID_QA_JSON}\n\`\`\``,
    );
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('present');
  });

  it('accepts fenced block without json language tag', () => {
    const body = buildPrd(`## QA State\n\n\`\`\`\n${VALID_QA_JSON}\n\`\`\``);
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('present');
    expect(result.qaState?.featureId).toBe('issue-42');
  });

  it('validates criticalFlows has at least one entry', () => {
    const noFlows = JSON.stringify({
      featureId: 'issue-1',
      routes: ['/'],
      criticalFlows: [],
      expectedStates: ['loaded'],
      testDataAssumptions: [],
      selectorReadiness: 'missing',
    });
    const body = buildPrd(`## QA State\n\n\`\`\`json\n${noFlows}\n\`\`\``);
    const result = extractFeatureQaState(body);
    expect(result.status).toBe('invalid');
  });

  it('extracts visual assertions and evidence policy', () => {
    const qaJson = JSON.stringify({
      ...JSON.parse(VALID_QA_JSON),
      visualAssertions: [
        {
          name: 'Create button is pinned top left',
          route: '/dashboard',
          targetSelector: '[data-testid="create-button"]',
          containerSelector: '[data-testid="toolbar"]',
          assertion: 'top-left-of-container',
          tolerancePx: 24,
          viewport: { width: 1440, height: 900 },
        },
      ],
      evidencePolicy: {
        screenshot: 'always',
        trace: 'on-failure',
        video: 'on-failure',
      },
    });

    const body = buildPrd(`## QA State\n\n\`\`\`json\n${qaJson}\n\`\`\``);
    const result = extractFeatureQaState(body);

    expect(result.status).toBe('present');
    expect(result.qaState?.visualAssertions).toEqual([
      {
        name: 'Create button is pinned top left',
        route: '/dashboard',
        targetSelector: '[data-testid="create-button"]',
        containerSelector: '[data-testid="toolbar"]',
        assertion: 'top-left-of-container',
        tolerancePx: 24,
        viewport: { width: 1440, height: 900 },
      },
    ]);
    expect(result.qaState?.evidencePolicy).toEqual({
      screenshot: 'always',
      trace: 'on-failure',
      video: 'on-failure',
    });
  });

  it('rejects container-position visual assertions without a container selector', () => {
    const qaJson = JSON.stringify({
      ...JSON.parse(VALID_QA_JSON),
      visualAssertions: [
        {
          name: 'Create button is pinned top left',
          route: '/dashboard',
          targetSelector: '[data-testid="create-button"]',
          assertion: 'top-left-of-container',
        },
      ],
    });

    const body = buildPrd(`## QA State\n\n\`\`\`json\n${qaJson}\n\`\`\``);
    const result = extractFeatureQaState(body);

    expect(result.status).toBe('invalid');
    expect(result.reason).toContain('containerSelector');
  });

  it('rejects relational visual assertions without a reference selector', () => {
    const qaJson = JSON.stringify({
      ...JSON.parse(VALID_QA_JSON),
      visualAssertions: [
        {
          name: 'Create button is left of save',
          route: '/dashboard',
          targetSelector: '[data-testid="create-button"]',
          assertion: 'left-of',
        },
      ],
    });

    const body = buildPrd(`## QA State\n\n\`\`\`json\n${qaJson}\n\`\`\``);
    const result = extractFeatureQaState(body);

    expect(result.status).toBe('invalid');
    expect(result.reason).toContain('referenceSelector');
  });
});

describe('buildQaStateGapMessage', () => {
  it('builds absent message with issue number', () => {
    const msg = buildQaStateGapMessage('absent', 'No section', 42);
    expect(msg).toContain('issue #42');
    expect(msg).toContain('No feature-scoped QA state');
    expect(msg).toContain('## QA State');
  });

  it('builds absent message without issue number', () => {
    const msg = buildQaStateGapMessage('absent', 'No section');
    expect(msg).not.toContain('issue #');
    expect(msg).toContain('No feature-scoped QA state');
  });

  it('builds invalid message with reason', () => {
    const msg = buildQaStateGapMessage('invalid', 'Missing featureId field', 10);
    expect(msg).toContain('issue #10');
    expect(msg).toContain('Missing featureId field');
  });

  it('omits falsy issue numbers from gap messages', () => {
    expect(buildQaStateGapMessage('invalid', 'Missing JSON', 0)).toBe('[QA gap] Missing JSON');
  });
});

describe('QA_STATE_SECTION_HEADING', () => {
  it('is the expected heading', () => {
    expect(QA_STATE_SECTION_HEADING).toBe('## QA State');
  });
});
