import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCoverageRows,
  formatCoverageFailures,
  resolveGateMinimum,
  summarizeCoverage,
} from './coverage-gate.mjs';

test('coverage gate precedence prefers environment, then manifest, then fallback', () => {
  assert.equal(
    resolveGateMinimum({
      env: { E2E_COVERAGE_MIN: '91' },
      envName: 'E2E_COVERAGE_MIN',
      fallback: 80,
      manifest: { gateMinPct: 90 },
    }),
    91,
  );
  assert.equal(
    resolveGateMinimum({
      env: {},
      envName: 'E2E_COVERAGE_MIN',
      fallback: 80,
      manifest: { gateMinPct: 90 },
    }),
    90,
  );
  assert.equal(
    resolveGateMinimum({
      env: {},
      envName: 'E2E_COVERAGE_MIN',
      fallback: 80,
      manifest: {},
    }),
    80,
  );
});

test('coverage gate rejects non-finite and out-of-range thresholds', () => {
  for (const value of ['not-a-number', '-1', '101']) {
    assert.throws(
      () =>
        resolveGateMinimum({
          env: { E2E_COVERAGE_MIN: value },
          envName: 'E2E_COVERAGE_MIN',
          fallback: 80,
          manifest: {},
        }),
      /invalid coverage gate/,
    );
  }
});

test('coverage rows require every assigned spec before counting a claim', () => {
  const rows = buildCoverageRows({
    entries: [
      { covered: true, id: 'complete', specs: ['coverage-gate.test.mjs'] },
      { covered: true, id: 'drifted', specs: ['missing.test.mjs'] },
      { covered: false, id: 'unclaimed', specs: ['coverage-gate.test.mjs'] },
    ],
    getSpecs: (entry) => entry.specs,
    mapRow: (entry, coverage) => ({ id: entry.id, specs: coverage.specStatuses }),
    packageRoot: fileURLToPath(new URL('.', import.meta.url)),
  });

  assert.deepEqual(
    rows.map(({ counted, id }) => ({ counted, id })),
    [
      { counted: true, id: 'complete' },
      { counted: false, id: 'drifted' },
      { counted: false, id: 'unclaimed' },
    ],
  );

  const summary = summarizeCoverage(rows);
  assert.deepEqual(
    {
      covered: summary.covered,
      coveredPct: summary.coveredPct,
      drift: summary.driftRows.map((row) => row.id),
      total: summary.total,
    },
    { covered: 1, coveredPct: 33.33, drift: ['drifted'], total: 3 },
  );
});

test('empty coverage summaries remain finite', () => {
  assert.deepEqual(summarizeCoverage([]), {
    covered: 0,
    coveredPct: 0,
    driftRows: [],
    total: 0,
    uncovered: [],
  });
});

test('coverage failures retain every validation message', () => {
  assert.equal(formatCoverageFailures(['first', 'second']), 'first\n✗ second');
  assert.equal(formatCoverageFailures(['first', 'second'], 'FAIL'), 'first\nFAIL second');
});
