import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractFeatureQaState,
  type FeatureQaState,
  repoSetupContractSchema,
} from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectQaEvidencePaths,
  formatVisualQaFailureFeedback,
  getVisualQaToolingStatus,
  hasVisualQaAssertions,
  summarizeQaFlowResults,
  toQaStatus,
  writeVisualQaRuntimeTest,
} from './visual-qa';

const QA_STATE: FeatureQaState = {
  featureId: 'issue-42',
  routes: ['/dashboard'],
  criticalFlows: [
    {
      name: 'create button placement',
      steps: ['open dashboard'],
      successCriteria: 'Create button is top-left in toolbar',
    },
  ],
  expectedStates: ['dashboard loaded'],
  testDataAssumptions: [],
  selectorReadiness: 'ready',
  visualAssertions: [
    {
      name: 'Create button is pinned top left',
      route: '/dashboard',
      targetSelector: '[data-testid="create-button"]',
      containerSelector: '[data-testid="toolbar"]',
      assertion: 'top-left-of-container',
      tolerancePx: 24,
      viewport: { width: 390, height: 844 },
    },
  ],
  evidencePolicy: {
    screenshot: 'always',
    trace: 'on-failure',
    video: 'on-failure',
  },
};

describe('visual QA runtime test generation', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `visual-qa-${Date.now()}`);
    mkdirSync(join(root, '.git', 'info'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it('detects feature QA states with visual assertions', () => {
    expect(hasVisualQaAssertions(QA_STATE)).toBe(true);
    expect(hasVisualQaAssertions({ ...QA_STATE, visualAssertions: [] })).toBe(false);
    expect(hasVisualQaAssertions(null)).toBe(false);
  });

  it('writes a Playwright runner, config, and generated spec', () => {
    const result = writeVisualQaRuntimeTest(root, 'thread-1', QA_STATE, 'run-1');

    expect(result.artifactRoot).toBe(join(root, '.shipcode', 'qa-artifacts', 'thread-1', 'run-1'));
    expect(result.resultPath).toBe(join(result.artifactRoot, 'qa-results.json'));
    expect(existsSync(result.runnerPath)).toBe(true);
    expect(
      existsSync(join(root, '.shipcode', 'runtime-tests', 'visual-qa.generated.spec.ts')),
    ).toBe(true);
    expect(
      existsSync(join(root, '.shipcode', 'runtime-tests', 'playwright.generated.config.ts')),
    ).toBe(true);
  });

  it('embeds visual assertion logic and artifact output in the generated spec', () => {
    writeVisualQaRuntimeTest(root, 'thread-1', QA_STATE, 'run-1');
    const spec = readFileSync(
      join(root, '.shipcode', 'runtime-tests', 'visual-qa.generated.spec.ts'),
      'utf-8',
    );

    expect(spec).toContain('top-left-of-container');
    expect(spec).toContain('target left/top within');
    expect(spec).toContain('<qa_results>');
    expect(spec).toContain('page.screenshot');
  });

  it('excludes generated QA artifacts from git commits without deleting them', () => {
    writeVisualQaRuntimeTest(root, 'thread-1', QA_STATE, 'run-1');
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');

    expect(exclude).toContain('.shipcode/qa-artifacts/');
    expect(existsSync(join(root, '.shipcode', 'qa-artifacts', 'thread-1', 'run-1'))).toBe(true);
  });

  it('updates the real gitdir exclude file for linked worktrees', () => {
    const gitDir = join(root, '.gitdir');
    rmSync(join(root, '.git'), { recursive: true, force: true });
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(join(root, '.git'), `gitdir: ${gitDir}\n`);

    writeVisualQaRuntimeTest(root, 'thread-1', QA_STATE, 'run-1');

    const exclude = readFileSync(join(gitDir, 'info', 'exclude'), 'utf-8');
    expect(exclude).toContain('.shipcode/qa-artifacts/');
  });

  it('reports project-local Playwright as the preferred tooling', () => {
    const binDir = join(root, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const playwrightPath = join(binDir, 'playwright');
    writeFileSync(playwrightPath, '#!/usr/bin/env bash\n');
    chmodSync(playwrightPath, 0o755);

    const status = getVisualQaToolingStatus(root);

    expect(status).toEqual({
      available: true,
      runner: 'local',
      message: 'Using project-local Playwright.',
      warning: null,
    });
  });

  it('reports unavailable Playwright tooling before runtime QA starts', () => {
    const status = getVisualQaToolingStatus(root, '');

    expect(status.available).toBe(false);
    expect(status.message).toContain('Visual QA requires Playwright tooling');
  });

  it('dogfoods a PRD QA State with runtime QA server configuration', () => {
    const setup = repoSetupContractSchema.parse({
      version: 1,
      setupCommands: [],
      verifyCommands: [],
      envFiles: [],
      setupBeforeVerify: false,
      testingContext: null,
      runtimeQa: {
        server: {
          command: 'bun run dev --host 127.0.0.1',
          readinessUrl: 'http://127.0.0.1:$PORT',
          startupTimeoutMs: 60_000,
          portEnvVar: 'PORT',
        },
        testCommands: [],
        discoverAgentTests: true,
      },
    });
    const prd = `# PRD: Move create button

## QA State

\`\`\`json
${JSON.stringify(QA_STATE, null, 2)}
\`\`\``;
    const extracted = extractFeatureQaState(prd);

    expect(setup.runtimeQa?.server?.command).toContain('bun run dev');
    expect(extracted.status).toBe('present');
    if (!extracted.qaState) throw new Error('Expected QA state');

    const generated = writeVisualQaRuntimeTest(root, 'thread-1', extracted.qaState, 'dogfood-run');

    expect(readFileSync(generated.runnerPath, 'utf-8')).toContain('playwright test');
    expect(
      readFileSync(
        join(root, '.shipcode', 'runtime-tests', 'visual-qa.generated.spec.ts'),
        'utf-8',
      ),
    ).toContain('Create button is pinned top left');
  });
});

describe('visual QA result helpers', () => {
  it('summarizes status and evidence paths', () => {
    const results = [
      {
        flowName: 'button placement',
        passed: false,
        failureReason: 'wrong corner',
        evidencePaths: ['/tmp/qa/button.png'],
        assertions: [
          {
            name: 'button placement',
            passed: false,
            expected: 'top left',
            actual: 'bottom right',
            evidencePath: '/tmp/qa/button.png',
          },
        ],
      },
      {
        flowName: 'visible',
        passed: true,
        evidencePaths: ['/tmp/qa/visible.png'],
      },
    ];

    expect(toQaStatus(results)).toBe('partial');
    expect(summarizeQaFlowResults(results)).toContain('1/2 visual QA assertion(s) failed');
    expect(collectQaEvidencePaths(results)).toEqual(['/tmp/qa/button.png', '/tmp/qa/visible.png']);
    expect(formatVisualQaFailureFeedback(results)).toContain(
      'expected top left; actual bottom right',
    );
  });
});
