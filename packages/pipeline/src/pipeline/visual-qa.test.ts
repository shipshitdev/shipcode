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

  it('builds a timestamped run id when none is supplied', () => {
    const result = writeVisualQaRuntimeTest(root, 'thread-1', QA_STATE);

    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.runId).not.toContain(':');
    expect(result.artifactRoot).toContain(result.runId);
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

  it('resolves relative linked worktree gitdir files', () => {
    const gitDir = join(root, '.gitdir-relative');
    rmSync(join(root, '.git'), { recursive: true, force: true });
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(join(root, '.git'), 'gitdir: .gitdir-relative\n');

    writeVisualQaRuntimeTest(root, 'thread-1', QA_STATE, 'run-1');

    const exclude = readFileSync(join(gitDir, 'info', 'exclude'), 'utf-8');
    expect(exclude).toContain('.shipcode/qa-artifacts/');
  });

  it('falls back to the .git path when a git file has no gitdir directive', () => {
    rmSync(join(root, '.git'), { recursive: true, force: true });
    writeFileSync(join(root, '.git'), 'not a gitdir file\n');

    expect(() => writeVisualQaRuntimeTest(root, 'thread-1', QA_STATE, 'run-1')).toThrow(/ENOTDIR/);
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

  it('falls back to npx and then bunx from PATH when local Playwright is missing', () => {
    const npxDir = join(root, 'npx-bin');
    const bunxDir = join(root, 'bunx-bin');
    mkdirSync(npxDir, { recursive: true });
    mkdirSync(bunxDir, { recursive: true });
    const npxPath = join(npxDir, 'npx');
    const bunxPath = join(bunxDir, 'bunx');
    writeFileSync(npxPath, '#!/usr/bin/env bash\n');
    writeFileSync(bunxPath, '#!/usr/bin/env bash\n');
    chmodSync(npxPath, 0o755);
    chmodSync(bunxPath, 0o755);

    expect(getVisualQaToolingStatus(root, `${npxDir}:${bunxDir}`)).toMatchObject({
      available: true,
      runner: 'npx',
    });
    expect(getVisualQaToolingStatus(root, bunxDir)).toMatchObject({
      available: true,
      runner: 'bunx',
    });
  });

  it('uses an empty default PATH when PATH is unset', () => {
    const originalPath = process.env.PATH;
    delete process.env.PATH;
    try {
      expect(getVisualQaToolingStatus(root)).toMatchObject({
        available: false,
        runner: null,
      });
    } finally {
      process.env.PATH = originalPath;
    }
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
          readinessUrl: 'http://127.0.0.1:3000/healthz',
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

  it('generates Playwright config variants from evidence policy settings', () => {
    writeVisualQaRuntimeTest(
      root,
      'thread-1',
      {
        ...QA_STATE,
        evidencePolicy: {
          screenshot: 'on-failure',
          trace: 'always',
          video: 'always',
        },
      },
      'policy-always',
    );
    const alwaysConfig = readFileSync(
      join(root, '.shipcode', 'runtime-tests', 'playwright.generated.config.ts'),
      'utf-8',
    );
    expect(alwaysConfig).toContain('screenshot: "only-on-failure"');
    expect(alwaysConfig).toContain('trace: "on"');
    expect(alwaysConfig).toContain('video: "on"');

    writeVisualQaRuntimeTest(
      root,
      'thread-1',
      {
        ...QA_STATE,
        evidencePolicy: {
          screenshot: 'always',
          trace: 'on-retry',
          video: 'on-retry',
        },
      },
      'policy-retry',
    );
    const retryConfig = readFileSync(
      join(root, '.shipcode', 'runtime-tests', 'playwright.generated.config.ts'),
      'utf-8',
    );
    expect(retryConfig).toContain('trace: "on-first-retry"');
    expect(retryConfig).toContain('video: "on-first-retry"');

    writeVisualQaRuntimeTest(
      root,
      'thread-1',
      {
        ...QA_STATE,
        evidencePolicy: {
          screenshot: 'always',
          trace: 'on-failure',
          video: 'off',
        },
      },
      'policy-off',
    );
    const offConfig = readFileSync(
      join(root, '.shipcode', 'runtime-tests', 'playwright.generated.config.ts'),
      'utf-8',
    );
    expect(offConfig).toContain('video: "off"');
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

  it('handles empty, all-passing, and all-failing flow result summaries', () => {
    expect(toQaStatus([])).toBe('failed');
    expect(summarizeQaFlowResults([])).toBe('0/0 visual QA assertion(s) passed.');
    expect(formatVisualQaFailureFeedback([])).toBe('');

    expect(
      summarizeQaFlowResults([
        {
          flowName: 'visible',
          passed: true,
        },
      ]),
    ).toBe('1/1 visual QA assertion(s) passed.');
    expect(toQaStatus([{ flowName: 'visible', passed: true }])).toBe('passed');

    const failedWithoutAssertions = [
      {
        flowName: 'placement',
        passed: false,
      },
    ];
    expect(toQaStatus(failedWithoutAssertions)).toBe('failed');
    expect(summarizeQaFlowResults(failedWithoutAssertions)).toBe(
      '1/1 visual QA assertion(s) failed.',
    );
    expect(formatVisualQaFailureFeedback(failedWithoutAssertions)).toContain(
      '- placement: Visual QA failed.',
    );
  });

  it('deduplicates evidence from flow and assertion paths', () => {
    expect(
      collectQaEvidencePaths([
        {
          flowName: 'flow',
          passed: false,
          evidencePaths: ['/tmp/shared.png'],
          assertions: [
            {
              name: 'a',
              passed: false,
              expected: 'expected',
              actual: 'actual',
              evidencePath: '/tmp/shared.png',
            },
            {
              name: 'b',
              passed: false,
              expected: 'expected',
              actual: 'actual',
              evidencePath: '/tmp/other.png',
            },
          ],
        },
      ]),
    ).toEqual(['/tmp/other.png', '/tmp/shared.png']);
  });

  it('handles missing flow evidence arrays and assertion evidence paths', () => {
    const results = [
      {
        flowName: 'flow',
        passed: false,
        assertions: [
          {
            name: 'a',
            passed: false,
            expected: 'expected',
            actual: 'actual',
          },
        ],
      },
    ];

    expect(collectQaEvidencePaths(results)).toEqual([]);
    expect(formatVisualQaFailureFeedback(results)).toContain(
      '- a: expected expected; actual actual.',
    );
    expect(formatVisualQaFailureFeedback(results)).not.toContain('evidence:');
  });
});
