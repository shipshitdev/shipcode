#!/usr/bin/env node
/*
 * Deterministic E2E app-coverage gate.
 *
 * Reads app-coverage.manifest.json, compares it to package manifests under
 * apps/<name>/package.json, and
 * fails when a product app is missing coverage, a stale app remains in the
 * manifest, or a covered app points at missing spec files.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..');
const APPS_ROOT = path.join(REPO_ROOT, 'apps');
const MANIFEST = path.join(PKG_ROOT, 'app-coverage.manifest.json');
const ARTIFACT = path.join(PKG_ROOT, 'e2e-app-coverage.json');

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

if (!existsSync(MANIFEST)) fail(`manifest not found at ${MANIFEST}`);

const manifest = readJson(MANIFEST);
const appEntries = Array.isArray(manifest.apps) ? manifest.apps : [];
if (appEntries.length === 0) fail('app manifest contains no apps');

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
const manifestByPath = new Map(appEntries.map((app) => [app.path, app]));

const missing = discoveredApps.filter((app) => !manifestByPath.has(app.path));
const stale = appEntries.filter((app) => !discoveredByPath.has(app.path));
const packageMismatches = appEntries
  .filter((app) => discoveredByPath.has(app.path))
  .filter((app) => discoveredByPath.get(app.path).packageName !== app.packageName)
  .map((app) => ({
    id: app.id,
    expected: discoveredByPath.get(app.path).packageName,
    actual: app.packageName,
  }));

const ids = new Set();
for (const app of appEntries) {
  if (!app.id || typeof app.id !== 'string') fail('app is missing a string id');
  if (ids.has(app.id)) fail(`duplicate app id: ${app.id}`);
  ids.add(app.id);
  if (!app.path || typeof app.path !== 'string') fail(`${app.id} is missing path`);
  if (!app.packageName || typeof app.packageName !== 'string') {
    fail(`${app.id} is missing packageName`);
  }
  if (!Array.isArray(app.specs) || app.specs.length === 0) fail(`${app.id} is missing specs`);
}

const envMin = process.env.E2E_APP_COVERAGE_MIN;
const gateMin =
  envMin !== undefined && envMin !== ''
    ? Number(envMin)
    : typeof manifest.gateMinPct === 'number'
      ? manifest.gateMinPct
      : 100;

if (!Number.isFinite(gateMin) || gateMin < 0 || gateMin > 100) {
  fail(`invalid coverage gate: ${gateMin}`);
}

const rows = appEntries.map((app) => {
  const specStatuses = app.specs.map((spec) => ({
    spec,
    exists: existsSync(path.join(PKG_ROOT, spec)),
  }));
  const claimed = app.covered === true;
  const specsExist = specStatuses.every((spec) => spec.exists);
  const counted = claimed && specsExist;
  return {
    id: app.id,
    packageName: app.packageName,
    path: app.path,
    kind: app.kind ?? 'app',
    title: app.title ?? app.id,
    claimed,
    specs: specStatuses,
    counted,
    rationale: app.rationale ?? '',
  };
});

const total = rows.length;
const covered = rows.filter((row) => row.counted).length;
const coveredPct = Number(((covered / total) * 100).toFixed(2));
const driftRows = rows.filter((row) => row.claimed && !row.specs.every((spec) => spec.exists));
const uncovered = rows.filter((row) => !row.counted);

const artifact = {
  total,
  covered,
  coveredPct,
  gateMinPct: gateMin,
  discoveredApps,
  passed:
    coveredPct >= gateMin &&
    missing.length === 0 &&
    stale.length === 0 &&
    packageMismatches.length === 0 &&
    driftRows.length === 0,
  missing,
  stale,
  packageMismatches,
  uncovered: uncovered.map((row) => ({
    id: row.id,
    packageName: row.packageName,
    path: row.path,
    reason: row.claimed ? 'spec-missing' : 'not-covered',
    missingSpecs: row.specs.filter((spec) => !spec.exists).map((spec) => spec.spec),
    rationale: row.rationale,
  })),
};
writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);

console.log('\nE2E app coverage');
for (const row of rows) {
  const mark = row.counted ? '✓' : row.claimed ? '⚠' : '·';
  console.log(`  ${mark} ${row.id} (${row.packageName})`);
}
console.log(`\nCovered ${covered}/${total} = ${coveredPct}% (gate ${gateMin}%)`);

if (missing.length > 0) {
  fail(`app manifest missing apps: ${missing.map((app) => app.path).join(', ')}`);
}
if (stale.length > 0) {
  fail(`app manifest has stale apps: ${stale.map((app) => app.path).join(', ')}`);
}
if (packageMismatches.length > 0) {
  fail(
    `app manifest package mismatches: ${packageMismatches
      .map((app) => `${app.id} expected ${app.expected} got ${app.actual}`)
      .join(', ')}`,
  );
}
if (driftRows.length > 0) {
  fail(
    `manifest drift — covered apps missing spec files: ${driftRows
      .map((row) => row.id)
      .join(', ')}`,
  );
}
if (coveredPct < gateMin) {
  fail(`app coverage ${coveredPct}% < gate ${gateMin}%`);
}
console.log(`\n✓ E2E app coverage gate passed (${coveredPct}% ≥ ${gateMin}%).`);
