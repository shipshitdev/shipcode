#!/usr/bin/env node
/*
 * Deterministic E2E page-coverage gate.
 *
 * Reads page-coverage.manifest.json, counts every desktop/web/docs surface
 * marked `covered: true` whose spec file exists on disk, writes a
 * machine-readable e2e-page-coverage.json artifact, and exits non-zero when
 * coverage falls below the gate or the manifest drifts ahead of specs.
 *
 * Gate precedence: E2E_PAGE_COVERAGE_MIN env > manifest.gateMinPct > 100.
 */
import path from 'node:path';
import { failCoverageGate, resolveCoveragePaths, runCoverageGate } from './lib/coverage-gate.mjs';

const { packageRoot: PKG_ROOT } = resolveCoveragePaths(import.meta.url);
const MANIFEST = path.join(PKG_ROOT, 'page-coverage.manifest.json');
const ARTIFACT = path.join(PKG_ROOT, 'e2e-page-coverage.json');

runCoverageGate({
  artifactPath: ARTIFACT,
  artifactBeforePassed: ({ rows }) => {
    const byKind = rows.reduce((acc, row) => {
      const current = acc[row.kind] ?? { total: 0, covered: 0 };
      current.total += 1;
      if (row.counted) current.covered += 1;
      acc[row.kind] = current;
      return acc;
    }, {});
    return { byKind };
  },
  defaultGateMin: 100,
  emptyMessage: 'manifest contains no surfaces',
  entriesKey: 'surfaces',
  envName: 'E2E_PAGE_COVERAGE_MIN',
  formatRow: (row) => {
    const mark = row.counted ? '✓' : row.claimed && !row.specExists ? '⚠' : '·';
    const pathSuffix = row.path ? ` ${row.path}` : '';
    return `  ${mark} ${row.id}${pathSuffix}${row.counted ? '' : `  (${row.spec || 'no spec'})`}`;
  },
  formatSuccess: ({ coveredPct, gateMin }) =>
    `✓ E2E page coverage gate passed (${coveredPct}% ≥ ${gateMin}%).`,
  getFailureMessages: ({ coveredPct, driftRows, gateMin }) => [
    driftRows.length > 0
      ? `manifest drift — covered surfaces missing their spec file: ${driftRows.map((row) => row.id).join(', ')}`
      : null,
    coveredPct < gateMin ? `page coverage ${coveredPct}% < gate ${gateMin}%` : null,
  ],
  getSpecs: (surface) => [surface.spec ?? ''],
  manifestPath: MANIFEST,
  mapUncovered: (row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    path: row.path,
    reason: row.claimed && !row.specExists ? 'spec-missing' : 'not-covered',
    rationale: row.rationale,
    followUp: row.followUp,
  }),
  mapRow: (surface, { specStatuses }) => ({
    id: surface.id,
    kind: surface.kind,
    title: surface.title,
    path: surface.path ?? null,
    spec: specStatuses[0].spec,
    specExists: specStatuses[0].exists,
    rationale: surface.rationale ?? '',
    followUp: surface.followUp ?? null,
  }),
  packageRoot: PKG_ROOT,
  title: 'E2E page coverage',
  validateEntries: (surfaces) => {
    const ids = new Set();
    for (const surface of surfaces) {
      if (!surface.id || typeof surface.id !== 'string') {
        failCoverageGate('surface is missing a string id');
      }
      if (ids.has(surface.id)) failCoverageGate(`duplicate surface id: ${surface.id}`);
      ids.add(surface.id);
      if (!surface.kind || typeof surface.kind !== 'string') {
        failCoverageGate(`${surface.id} is missing kind`);
      }
      if (!surface.title || typeof surface.title !== 'string') {
        failCoverageGate(`${surface.id} is missing title`);
      }
    }
  },
});
