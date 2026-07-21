#!/usr/bin/env node
/*
 * Deterministic E2E flow-coverage gate.
 *
 * Reads flow-coverage.manifest.json, counts the critical journeys marked
 * `covered: true` whose spec file actually exists on disk, computes the
 * covered percentage, writes a machine-readable e2e-flow-coverage.json
 * artifact, and exits non-zero when coverage falls below the gate.
 *
 * Gate precedence: E2E_FLOW_COVERAGE_MIN env > manifest.gateMinPct > 80.
 * A flow flagged covered whose spec file is missing is treated as uncovered
 * AND fails the run, so the manifest can never drift ahead of reality.
 */
import path from 'node:path';
import { resolveCoveragePaths, runCoverageGate } from './lib/coverage-gate.mjs';

const { packageRoot: PKG_ROOT } = resolveCoveragePaths(import.meta.url);
const MANIFEST = path.join(PKG_ROOT, 'flow-coverage.manifest.json');
const ARTIFACT = path.join(PKG_ROOT, 'e2e-flow-coverage.json');

runCoverageGate({
  artifactPath: ARTIFACT,
  defaultGateMin: 80,
  emptyMessage: 'manifest contains no flows',
  entriesKey: 'flows',
  envName: 'E2E_FLOW_COVERAGE_MIN',
  formatRow: (row) => {
    const mark = row.counted ? '✓' : row.claimed && !row.specExists ? '⚠' : '·';
    return `  ${mark} ${row.id}${row.counted ? '' : `  (${row.spec || 'no spec'})`}`;
  },
  formatSuccess: ({ coveredPct, gateMin }) =>
    `✓ E2E flow coverage gate passed (${coveredPct}% ≥ ${gateMin}%).`,
  getFailureMessages: ({ coveredPct, driftRows, gateMin }) => [
    driftRows.length > 0
      ? `manifest drift — covered flows missing their spec file: ${driftRows.map((row) => row.id).join(', ')}`
      : null,
    coveredPct < gateMin ? `flow coverage ${coveredPct}% < gate ${gateMin}%` : null,
  ],
  getSpecs: (flow) => [flow.spec ?? ''],
  manifestPath: MANIFEST,
  mapUncovered: (row) => ({
    id: row.id,
    title: row.title,
    reason: row.claimed && !row.specExists ? 'spec-missing' : 'not-covered',
    rationale: row.rationale,
    followUp: row.followUp,
  }),
  mapRow: (flow, { specStatuses }) => ({
    id: flow.id,
    title: flow.title,
    spec: specStatuses[0].spec,
    specExists: specStatuses[0].exists,
    rationale: flow.rationale ?? '',
    followUp: flow.followUp ?? null,
  }),
  packageRoot: PKG_ROOT,
  title: 'E2E flow coverage',
});
