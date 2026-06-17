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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const MANIFEST = path.join(PKG_ROOT, 'page-coverage.manifest.json');
const ARTIFACT = path.join(PKG_ROOT, 'e2e-page-coverage.json');

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!existsSync(MANIFEST)) fail(`manifest not found at ${MANIFEST}`);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const surfaces = Array.isArray(manifest.surfaces) ? manifest.surfaces : [];
if (surfaces.length === 0) fail('manifest contains no surfaces');

const ids = new Set();
for (const surface of surfaces) {
  if (!surface.id || typeof surface.id !== 'string') fail('surface is missing a string id');
  if (ids.has(surface.id)) fail(`duplicate surface id: ${surface.id}`);
  ids.add(surface.id);
  if (!surface.kind || typeof surface.kind !== 'string') fail(`${surface.id} is missing kind`);
  if (!surface.title || typeof surface.title !== 'string') fail(`${surface.id} is missing title`);
}

const envMin = process.env.E2E_PAGE_COVERAGE_MIN;
const gateMin =
  envMin !== undefined && envMin !== ''
    ? Number(envMin)
    : typeof manifest.gateMinPct === 'number'
      ? manifest.gateMinPct
      : 100;

if (!Number.isFinite(gateMin) || gateMin < 0 || gateMin > 100) {
  fail(`invalid coverage gate: ${gateMin}`);
}

const rows = surfaces.map((surface) => {
  const claimed = surface.covered === true;
  const specRel = surface.spec ?? '';
  const specExists = specRel ? existsSync(path.join(PKG_ROOT, specRel)) : false;
  const counted = claimed && specExists;
  return {
    id: surface.id,
    kind: surface.kind,
    title: surface.title,
    path: surface.path ?? null,
    claimed,
    spec: specRel,
    specExists,
    counted,
    rationale: surface.rationale ?? '',
    followUp: surface.followUp ?? null,
  };
});

const total = rows.length;
const covered = rows.filter((row) => row.counted).length;
const coveredPct = Number(((covered / total) * 100).toFixed(2));
const driftRows = rows.filter((row) => row.claimed && !row.specExists);
const uncovered = rows.filter((row) => !row.counted);

const byKind = rows.reduce((acc, row) => {
  const current = acc[row.kind] ?? { total: 0, covered: 0 };
  current.total += 1;
  if (row.counted) current.covered += 1;
  acc[row.kind] = current;
  return acc;
}, {});

const artifact = {
  total,
  covered,
  coveredPct,
  gateMinPct: gateMin,
  byKind,
  passed: coveredPct >= gateMin && driftRows.length === 0,
  uncovered: uncovered.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    path: row.path,
    reason: row.claimed && !row.specExists ? 'spec-missing' : 'not-covered',
    rationale: row.rationale,
    followUp: row.followUp,
  })),
};
writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);

console.log('\nE2E page coverage');
for (const row of rows) {
  const mark = row.counted ? '✓' : row.claimed && !row.specExists ? '⚠' : '·';
  const pathSuffix = row.path ? ` ${row.path}` : '';
  console.log(
    `  ${mark} ${row.id}${pathSuffix}${row.counted ? '' : `  (${row.spec || 'no spec'})`}`,
  );
}
console.log(`\nCovered ${covered}/${total} = ${coveredPct}% (gate ${gateMin}%)`);

if (driftRows.length > 0) {
  fail(
    `manifest drift — covered surfaces missing their spec file: ${driftRows
      .map((row) => row.id)
      .join(', ')}`,
  );
}
if (coveredPct < gateMin) {
  fail(`page coverage ${coveredPct}% < gate ${gateMin}%`);
}
console.log(`\n✓ E2E page coverage gate passed (${coveredPct}% ≥ ${gateMin}%).`);
