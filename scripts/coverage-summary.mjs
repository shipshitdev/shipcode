import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SEARCH_ROOTS = ['apps', 'packages'];
const METRIC_KEYS = ['lines', 'statements', 'functions', 'branches'];
const DEFAULT_MIN_COVERAGE = 85;
const MIN_COVERAGE = Number(process.env.COVERAGE_MIN ?? DEFAULT_MIN_COVERAGE);

function findCoverageSummaries() {
  const found = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'coverage') {
          const summaryPath = path.join(fullPath, 'coverage-summary.json');
          if (fs.existsSync(summaryPath)) found.push(summaryPath);
          continue;
        }
        walk(fullPath);
      }
    }
  }

  for (const root of SEARCH_ROOTS) {
    const fullRoot = path.join(ROOT, root);
    if (fs.existsSync(fullRoot)) walk(fullRoot);
  }

  return found.sort();
}

function readSummary(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const total = raw.total;
  const packageRoot = path.dirname(path.dirname(filePath));
  return {
    packagePath: path.relative(ROOT, packageRoot),
    total,
  };
}

function emptyMetric() {
  return { total: 0, covered: 0, skipped: 0, pct: 100 };
}

function combineMetric(a, b) {
  const total = a.total + b.total;
  const covered = a.covered + b.covered;
  const skipped = a.skipped + b.skipped;
  const pct = total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2));
  return { total, covered, skipped, pct };
}

function formatPct(value) {
  return `${value.toFixed(2)}%`;
}

const summaries = findCoverageSummaries().map(readSummary);

if (summaries.length === 0) {
  console.error('No coverage-summary.json files found. Run coverage first.');
  process.exit(1);
}

const aggregate = Object.fromEntries(METRIC_KEYS.map((key) => [key, emptyMetric()]));
for (const summary of summaries) {
  for (const key of METRIC_KEYS) {
    aggregate[key] = combineMetric(aggregate[key], summary.total[key] ?? emptyMetric());
  }
}

console.log('\nCoverage by package');
for (const summary of summaries) {
  const linePct = summary.total.lines?.pct ?? 0;
  const statementPct = summary.total.statements?.pct ?? 0;
  const functionPct = summary.total.functions?.pct ?? 0;
  const branchPct = summary.total.branches?.pct ?? 0;
  console.log(
    `${summary.packagePath}: lines ${formatPct(linePct)}, statements ${formatPct(statementPct)}, functions ${formatPct(functionPct)}, branches ${formatPct(branchPct)}`,
  );
}

console.log('\nOverall coverage');
for (const key of METRIC_KEYS) {
  console.log(
    `${key}: ${formatPct(aggregate[key].pct)} (${aggregate[key].covered}/${aggregate[key].total})`,
  );
}

const belowThreshold = METRIC_KEYS.filter((key) => aggregate[key].pct < MIN_COVERAGE);

if (belowThreshold.length > 0) {
  console.error(
    `\nCoverage threshold failed. Minimum ${formatPct(MIN_COVERAGE)} required for: ${belowThreshold.join(', ')}`,
  );
  process.exit(1);
}

console.log(`\nCoverage threshold passed at ${formatPct(MIN_COVERAGE)}.`);
