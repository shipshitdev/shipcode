#!/usr/bin/env node
/*
 * Deterministic E2E app-coverage gate.
 *
 * Reads app-coverage.manifest.json, compares it to package manifests under
 * apps/<name>/package.json, and
 * fails when a product app is missing coverage, a stale app remains in the
 * manifest, or a covered app points at missing spec files.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  failCoverageGate,
  readJson,
  resolveCoveragePaths,
  runCoverageGate,
} from './lib/coverage-gate.mjs';

const { packageRoot: PKG_ROOT, repositoryRoot: REPO_ROOT } = resolveCoveragePaths(import.meta.url);
const APPS_ROOT = path.join(REPO_ROOT, 'apps');
const MANIFEST = path.join(PKG_ROOT, 'app-coverage.manifest.json');
const ARTIFACT = path.join(PKG_ROOT, 'e2e-app-coverage.json');

const discoveredApps = readdirSync(APPS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const packagePath = path.join(APPS_ROOT, entry.name, 'package.json');
    if (!existsSync(packagePath)) return null;
    const pkg = readJson(packagePath);
    return {
      id: entry.name,
      path: `apps/${entry.name}`,
      packageName: pkg.name,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.id.localeCompare(b.id));

const discoveredByPath = new Map(discoveredApps.map((app) => [app.path, app]));

let comparisons;

runCoverageGate({
  artifactPath: ARTIFACT,
  artifactAfterPassed: () => ({
    missing: comparisons.missing,
    stale: comparisons.stale,
    packageMismatches: comparisons.packageMismatches,
  }),
  artifactBeforePassed: () => ({ discoveredApps }),
  defaultGateMin: 100,
  emptyMessage: 'app manifest contains no apps',
  entriesKey: 'apps',
  envName: 'E2E_APP_COVERAGE_MIN',
  formatRow: (row) => {
    const mark = row.counted ? '✓' : row.claimed ? '⚠' : '·';
    return `  ${mark} ${row.id} (${row.packageName})`;
  },
  formatSuccess: ({ coveredPct, gateMin }) =>
    `✓ E2E app coverage gate passed (${coveredPct}% ≥ ${gateMin}%).`,
  getFailureMessages: ({ coveredPct, driftRows, gateMin }) => [
    comparisons.missing.length > 0
      ? `app manifest missing apps: ${comparisons.missing.map((app) => app.path).join(', ')}`
      : null,
    comparisons.stale.length > 0
      ? `app manifest has stale apps: ${comparisons.stale.map((app) => app.path).join(', ')}`
      : null,
    comparisons.packageMismatches.length > 0
      ? `app manifest package mismatches: ${comparisons.packageMismatches
          .map((app) => `${app.id} expected ${app.expected} got ${app.actual}`)
          .join(', ')}`
      : null,
    driftRows.length > 0
      ? `manifest drift — covered apps missing spec files: ${driftRows.map((row) => row.id).join(', ')}`
      : null,
    coveredPct < gateMin ? `app coverage ${coveredPct}% < gate ${gateMin}%` : null,
  ],
  getSpecs: (app) => app.specs,
  manifestPath: MANIFEST,
  mapUncovered: (row) => ({
    id: row.id,
    packageName: row.packageName,
    path: row.path,
    reason: row.claimed ? 'spec-missing' : 'not-covered',
    missingSpecs: row.specs.filter((spec) => !spec.exists).map((spec) => spec.spec),
    rationale: row.rationale,
  }),
  mapRow: (app, { specStatuses }) => ({
    id: app.id,
    packageName: app.packageName,
    path: app.path,
    kind: app.kind ?? 'app',
    title: app.title ?? app.id,
    specs: specStatuses,
    rationale: app.rationale ?? '',
  }),
  packageRoot: PKG_ROOT,
  title: 'E2E app coverage',
  validateEntries: (appEntries) => {
    const manifestByPath = new Map(appEntries.map((app) => [app.path, app]));
    comparisons = {
      missing: discoveredApps.filter((app) => !manifestByPath.has(app.path)),
      stale: appEntries.filter((app) => !discoveredByPath.has(app.path)),
      packageMismatches: appEntries
        .filter((app) => discoveredByPath.has(app.path))
        .filter((app) => discoveredByPath.get(app.path).packageName !== app.packageName)
        .map((app) => ({
          id: app.id,
          expected: discoveredByPath.get(app.path).packageName,
          actual: app.packageName,
        })),
    };

    const ids = new Set();
    for (const app of appEntries) {
      if (!app.id || typeof app.id !== 'string') failCoverageGate('app is missing a string id');
      if (ids.has(app.id)) failCoverageGate(`duplicate app id: ${app.id}`);
      ids.add(app.id);
      if (!app.path || typeof app.path !== 'string') {
        failCoverageGate(`${app.id} is missing path`);
      }
      if (!app.packageName || typeof app.packageName !== 'string') {
        failCoverageGate(`${app.id} is missing packageName`);
      }
      if (!Array.isArray(app.specs) || app.specs.length === 0) {
        failCoverageGate(`${app.id} is missing specs`);
      }
    }
  },
});
