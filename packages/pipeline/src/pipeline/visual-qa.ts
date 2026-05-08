import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type {
  FeatureQaEvidencePolicy,
  FeatureQaFlowResult,
  FeatureQaState,
} from '@shipcode/shared';

const RUNTIME_TESTS_DIR = '.shipcode/runtime-tests';
const QA_ARTIFACTS_DIR = '.shipcode/qa-artifacts';
const GENERATED_RUNNER = 'visual-qa.generated.test.sh';
const GENERATED_SPEC = 'visual-qa.generated.spec.ts';
const GENERATED_CONFIG = 'playwright.generated.config.ts';

export interface VisualQaRuntimeTest {
  artifactRoot: string;
  runnerPath: string;
  resultPath: string;
  runId: string;
}

export function hasVisualQaAssertions(qaState: FeatureQaState | null | undefined): boolean {
  return Boolean(qaState?.visualAssertions?.length);
}

export function writeVisualQaRuntimeTest(
  worktreePath: string,
  threadId: string,
  qaState: FeatureQaState,
  runId = buildVisualQaRunId(),
): VisualQaRuntimeTest {
  const testsDir = join(worktreePath, RUNTIME_TESTS_DIR);
  const artifactRoot = join(worktreePath, QA_ARTIFACTS_DIR, threadId, runId);
  const runnerPath = join(testsDir, GENERATED_RUNNER);
  const specPath = join(testsDir, GENERATED_SPEC);
  const configPath = join(testsDir, GENERATED_CONFIG);
  const resultPath = join(artifactRoot, 'qa-results.json');

  mkdirSync(testsDir, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  ensureGitInfoExclude(worktreePath, [
    `${QA_ARTIFACTS_DIR}/`,
    `${RUNTIME_TESTS_DIR}/${GENERATED_RUNNER}`,
    `${RUNTIME_TESTS_DIR}/${GENERATED_SPEC}`,
    `${RUNTIME_TESTS_DIR}/${GENERATED_CONFIG}`,
  ]);

  writeFileSync(specPath, buildVisualQaSpec(qaState), 'utf-8');
  writeFileSync(configPath, buildPlaywrightConfig(qaState.evidencePolicy), 'utf-8');
  writeFileSync(runnerPath, buildVisualQaRunner(worktreePath, artifactRoot, resultPath), {
    encoding: 'utf-8',
    mode: 0o755,
  });

  return { artifactRoot, runnerPath, resultPath, runId };
}

export function collectQaEvidencePaths(flowResults: FeatureQaFlowResult[]): string[] {
  const paths = new Set<string>();
  for (const flow of flowResults) {
    for (const path of flow.evidencePaths ?? []) paths.add(path);
    for (const assertion of flow.assertions ?? []) {
      if (assertion.evidencePath) paths.add(assertion.evidencePath);
    }
  }
  return [...paths].sort();
}

export function summarizeQaFlowResults(flowResults: FeatureQaFlowResult[]): string {
  const passed = flowResults.filter((flow) => flow.passed).length;
  const failed = flowResults.length - passed;
  if (failed === 0) return `${passed}/${flowResults.length} visual QA assertion(s) passed.`;
  const firstFailure = flowResults.find((flow) => !flow.passed)?.failureReason;
  return `${failed}/${flowResults.length} visual QA assertion(s) failed.${firstFailure ? ` ${firstFailure}` : ''}`;
}

export function toQaStatus(flowResults: FeatureQaFlowResult[]): 'passed' | 'failed' | 'partial' {
  if (flowResults.length === 0) return 'failed';
  if (flowResults.every((flow) => flow.passed)) return 'passed';
  if (flowResults.some((flow) => flow.passed)) return 'partial';
  return 'failed';
}

export function formatVisualQaFailureFeedback(flowResults: FeatureQaFlowResult[]): string {
  const failures = flowResults
    .filter((flow) => !flow.passed)
    .flatMap((flow) => {
      const assertionLines = (flow.assertions ?? [])
        .filter((assertion) => !assertion.passed)
        .map((assertion) => {
          const evidence = assertion.evidencePath ? ` evidence: ${assertion.evidencePath}` : '';
          return `- ${assertion.name}: expected ${assertion.expected}; actual ${assertion.actual}.${evidence}`;
        });
      if (assertionLines.length > 0) return assertionLines;
      return [`- ${flow.flowName}: ${flow.failureReason ?? 'Visual QA failed.'}`];
    })
    .slice(0, 10)
    .join('\n');

  if (!failures) return '';
  return [
    '',
    '',
    '<visual_qa_failure>',
    'Browser QA produced concrete evidence that the feature does not satisfy the requested UI contract.',
    failures,
    '</visual_qa_failure>',
  ].join('\n');
}

function buildVisualQaRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureGitInfoExclude(worktreePath: string, patterns: string[]) {
  const gitPath = join(worktreePath, '.git');
  let gitDir = gitPath;
  if (existsSync(gitPath) && statSync(gitPath).isFile()) {
    const gitFile = readFileSync(gitPath, 'utf-8');
    const match = /^gitdir:\s*(.+)$/m.exec(gitFile);
    if (match?.[1]) {
      gitDir = match[1].startsWith('/') ? match[1] : join(worktreePath, match[1]);
    }
  }
  const excludePath = join(gitDir, 'info', 'exclude');
  mkdirSync(dirname(excludePath), { recursive: true });
  const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
  const missing = patterns.filter((pattern) => !existing.includes(pattern));
  if (missing.length === 0) return;
  appendFileSync(excludePath, `\n# ShipCode generated QA artifacts\n${missing.join('\n')}\n`);
}

function buildVisualQaRunner(worktreePath: string, artifactRoot: string, resultPath: string) {
  const relativeSpec = relative(
    worktreePath,
    join(worktreePath, RUNTIME_TESTS_DIR, GENERATED_SPEC),
  );
  const relativeConfig = relative(
    worktreePath,
    join(worktreePath, RUNTIME_TESTS_DIR, GENERATED_CONFIG),
  );
  return `#!/usr/bin/env bash
set -euo pipefail
cd ${shellQuote(worktreePath)}
export SHIPCODE_QA_OUTPUT_DIR="${'${SHIPCODE_QA_OUTPUT_DIR:-'}${artifactRoot}${'}'}"
export SHIPCODE_QA_RESULT_PATH="${'${SHIPCODE_QA_RESULT_PATH:-'}${resultPath}${'}'}"
mkdir -p "$SHIPCODE_QA_OUTPUT_DIR"

if [ -x "./node_modules/.bin/playwright" ]; then
  ./node_modules/.bin/playwright test ${shellQuote(relativeSpec)} --config ${shellQuote(relativeConfig)}
elif command -v npx >/dev/null 2>&1; then
  npx --yes --package @playwright/test playwright test ${shellQuote(relativeSpec)} --config ${shellQuote(relativeConfig)}
elif command -v bunx >/dev/null 2>&1; then
  bunx --bun --package @playwright/test playwright test ${shellQuote(relativeSpec)} --config ${shellQuote(relativeConfig)}
else
  echo "ShipCode visual QA requires Playwright. Install @playwright/test or ensure npx/bunx is available." >&2
  exit 1
fi
`;
}

function buildPlaywrightConfig(policy: FeatureQaEvidencePolicy | undefined) {
  const screenshot = policy?.screenshot === 'on-failure' ? 'only-on-failure' : 'on';
  const trace =
    policy?.trace === 'always'
      ? 'on'
      : policy?.trace === 'on-retry'
        ? 'on-first-retry'
        : 'retain-on-failure';
  const video =
    policy?.video === 'always'
      ? 'on'
      : policy?.video === 'on-retry'
        ? 'on-first-retry'
        : policy?.video === 'off'
          ? 'off'
          : 'retain-on-failure';

  return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  reporter: [['line']],
  retries: 0,
  timeout: 60_000,
  outputDir: process.env.SHIPCODE_QA_OUTPUT_DIR
    ? process.env.SHIPCODE_QA_OUTPUT_DIR + '/playwright-output'
    : '.shipcode/qa-artifacts/playwright-output',
  use: {
    baseURL: process.env.BASE_URL,
    screenshot: ${JSON.stringify(screenshot)},
    trace: ${JSON.stringify(trace)},
    video: ${JSON.stringify(video)},
  },
});
`;
}

function buildVisualQaSpec(qaState: FeatureQaState) {
  return `import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';

const qaState = ${JSON.stringify(qaState, null, 2)} as const;
const artifactRoot = process.env.SHIPCODE_QA_OUTPUT_DIR ?? join(process.cwd(), '.shipcode', 'qa-artifacts', 'manual');
const resultPath = process.env.SHIPCODE_QA_RESULT_PATH ?? join(artifactRoot, 'qa-results.json');

type Box = { x: number; y: number; width: number; height: number };
type FlowResult = {
  flowName: string;
  passed: boolean;
  failureReason?: string;
  evidencePaths?: string[];
  assertions?: Array<{
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
    evidencePath?: string;
  }>;
};

test('ShipCode visual QA evidence', async ({ page }) => {
  mkdirSync(artifactRoot, { recursive: true });
  const results: FlowResult[] = [];

  for (const assertion of qaState.visualAssertions ?? []) {
    const screenshotPath = join(artifactRoot, safeName(assertion.name) + '.png');
    const evidencePaths = [screenshotPath, artifactRoot];
    const assertionResults: FlowResult['assertions'] = [];
    let passed = false;
    let failureReason = '';

    try {
      await page.setViewportSize(assertion.viewport ?? { width: 1440, height: 900 });
      await page.goto(assertion.route, { waitUntil: 'networkidle' });
      const target = locatorFor(page, assertion.targetSelector);
      const targetBox = await visibleBox(target, assertion.targetSelector);
      const outcome = await evaluateAssertion(page, assertion, targetBox);
      passed = outcome.passed;
      failureReason = outcome.passed ? '' : outcome.actual;
      assertionResults.push({
        name: assertion.name,
        passed: outcome.passed,
        expected: outcome.expected,
        actual: outcome.actual,
        evidencePath: screenshotPath,
      });
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
      assertionResults.push({
        name: assertion.name,
        passed: false,
        expected: expectedText(assertion),
        actual: failureReason,
        evidencePath: screenshotPath,
      });
    } finally {
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {}
    }

    results.push({
      flowName: assertion.name,
      passed,
      failureReason: passed ? undefined : failureReason,
      evidencePaths,
      assertions: assertionResults,
    });
  }

  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, JSON.stringify(results, null, 2));
  console.log('<qa_results>');
  console.log(JSON.stringify(results, null, 2));
  console.log('</qa_results>');

  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    throw new Error(failed.map((result) => result.failureReason ?? result.flowName).join('; '));
  }
});

function locatorFor(page: Page, selector: string): Locator {
  if (selector.startsWith('testid=')) return page.getByTestId(selector.slice('testid='.length));
  if (selector.startsWith('data-testid=')) {
    return page.getByTestId(selector.slice('data-testid='.length));
  }
  return page.locator(selector).first();
}

async function visibleBox(locator: Locator, label: string): Promise<Box> {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(\`Selector \${label} is visible but has no bounding box.\`);
  return box;
}

async function evaluateAssertion(
  page: Page,
  assertion: NonNullable<typeof qaState.visualAssertions>[number],
  targetBox: Box,
): Promise<{ passed: boolean; expected: string; actual: string }> {
  const tolerance = assertion.tolerancePx ?? 8;
  if (assertion.assertion === 'visible') {
    return {
      passed: true,
      expected: \`\${assertion.targetSelector} is visible\`,
      actual: \`target \${formatBox(targetBox)}\`,
    };
  }

  const containerBox = assertion.containerSelector
    ? await visibleBox(locatorFor(page, assertion.containerSelector), assertion.containerSelector)
    : null;
  const referenceBox = assertion.referenceSelector
    ? await visibleBox(locatorFor(page, assertion.referenceSelector), assertion.referenceSelector)
    : null;

  switch (assertion.assertion) {
    case 'top-left-of-container':
      return compare(
        targetBox.x <= containerBox!.x + tolerance && targetBox.y <= containerBox!.y + tolerance,
        \`target left/top within \${tolerance}px of container left/top\`,
        \`target \${formatBox(targetBox)} container \${formatBox(containerBox!)}\`,
      );
    case 'top-right-of-container':
      return compare(
        right(targetBox) >= right(containerBox!) - tolerance && targetBox.y <= containerBox!.y + tolerance,
        \`target right/top within \${tolerance}px of container right/top\`,
        \`target \${formatBox(targetBox)} container \${formatBox(containerBox!)}\`,
      );
    case 'bottom-left-of-container':
      return compare(
        targetBox.x <= containerBox!.x + tolerance && bottom(targetBox) >= bottom(containerBox!) - tolerance,
        \`target left/bottom within \${tolerance}px of container left/bottom\`,
        \`target \${formatBox(targetBox)} container \${formatBox(containerBox!)}\`,
      );
    case 'bottom-right-of-container':
      return compare(
        right(targetBox) >= right(containerBox!) - tolerance && bottom(targetBox) >= bottom(containerBox!) - tolerance,
        \`target right/bottom within \${tolerance}px of container right/bottom\`,
        \`target \${formatBox(targetBox)} container \${formatBox(containerBox!)}\`,
      );
    case 'not-overlapping':
      return compare(
        !overlaps(targetBox, referenceBox!),
        'target does not overlap reference',
        \`target \${formatBox(targetBox)} reference \${formatBox(referenceBox!)}\`,
      );
    case 'above':
      return compare(
        bottom(targetBox) <= referenceBox!.y + tolerance,
        \`target bottom is above reference top within \${tolerance}px\`,
        \`target \${formatBox(targetBox)} reference \${formatBox(referenceBox!)}\`,
      );
    case 'below':
      return compare(
        targetBox.y >= bottom(referenceBox!) - tolerance,
        \`target top is below reference bottom within \${tolerance}px\`,
        \`target \${formatBox(targetBox)} reference \${formatBox(referenceBox!)}\`,
      );
    case 'left-of':
      return compare(
        right(targetBox) <= referenceBox!.x + tolerance,
        \`target right is left of reference left within \${tolerance}px\`,
        \`target \${formatBox(targetBox)} reference \${formatBox(referenceBox!)}\`,
      );
    case 'right-of':
      return compare(
        targetBox.x >= right(referenceBox!) - tolerance,
        \`target left is right of reference right within \${tolerance}px\`,
        \`target \${formatBox(targetBox)} reference \${formatBox(referenceBox!)}\`,
      );
  }
}

function compare(passed: boolean, expected: string, actual: string) {
  return { passed, expected, actual };
}

function expectedText(assertion: NonNullable<typeof qaState.visualAssertions>[number]): string {
  return \`\${assertion.targetSelector} satisfies \${assertion.assertion}\`;
}

function right(box: Box): number {
  return box.x + box.width;
}

function bottom(box: Box): number {
  return box.y + box.height;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
}

function formatBox(box: Box): string {
  return \`x=\${Math.round(box.x)}, y=\${Math.round(box.y)}, w=\${Math.round(box.width)}, h=\${Math.round(box.height)}\`;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'visual-qa';
}
`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
