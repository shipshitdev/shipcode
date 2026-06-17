#!/usr/bin/env node
/*
 * Deterministic E2E behavior-coverage gate.
 *
 * A behavior is a page-level user contract: navigation, a primary action,
 * filtering/state transition, persistence, or route content assertion. This
 * gate makes those contracts explicit and links each one back to a page
 * surface from page-coverage.manifest.json.
 *
 * Gate precedence:
 * E2E_BEHAVIOR_COVERAGE_MIN env > manifest.gateMinPct > 100.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const BEHAVIOR_MANIFEST = path.join(PKG_ROOT, 'behavior-coverage.manifest.json');
const PAGE_MANIFEST = path.join(PKG_ROOT, 'page-coverage.manifest.json');
const ARTIFACT = path.join(PKG_ROOT, 'e2e-behavior-coverage.json');

const DEFAULT_REQUIRED_SURFACE_KINDS = [
  'desktop-view',
  'project-tab',
  'settings-section',
  'issue-tab',
  'web-route',
  'docs-route',
];

function fail(message) {
  console.error(`\nFAIL ${message}`);
  process.exit(1);
}

function readJson(file) {
  if (!existsSync(file)) fail(`manifest not found at ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

const manifest = readJson(BEHAVIOR_MANIFEST);
const pageManifest = readJson(PAGE_MANIFEST);
const behaviors = Array.isArray(manifest.behaviors) ? manifest.behaviors : [];
const surfaces = Array.isArray(pageManifest.surfaces) ? pageManifest.surfaces : [];

if (behaviors.length === 0) fail('manifest contains no behaviors');
if (surfaces.length === 0) fail('page manifest contains no surfaces');

const requiredSurfaceKinds = Array.isArray(manifest.requiredSurfaceKinds)
  ? manifest.requiredSurfaceKinds
  : DEFAULT_REQUIRED_SURFACE_KINDS;
const requiredKindSet = new Set(requiredSurfaceKinds);
const surfaceById = new Map();
for (const surface of surfaces) {
  if (!surface.id || typeof surface.id !== 'string') fail('surface is missing a string id');
  surfaceById.set(surface.id, surface);
}

const ids = new Set();
for (const behavior of behaviors) {
  if (!behavior.id || typeof behavior.id !== 'string') fail('behavior is missing a string id');
  if (ids.has(behavior.id)) fail(`duplicate behavior id: ${behavior.id}`);
  ids.add(behavior.id);
  if (!behavior.surfaceId || typeof behavior.surfaceId !== 'string') {
    fail(`${behavior.id} is missing surfaceId`);
  }
  if (!surfaceById.has(behavior.surfaceId)) {
    fail(`${behavior.id} references unknown surfaceId: ${behavior.surfaceId}`);
  }
  if (!behavior.title || typeof behavior.title !== 'string') {
    fail(`${behavior.id} is missing title`);
  }
}

const envMin = process.env.E2E_BEHAVIOR_COVERAGE_MIN;
const gateMin =
  envMin !== undefined && envMin !== ''
    ? Number(envMin)
    : typeof manifest.gateMinPct === 'number'
      ? manifest.gateMinPct
      : 100;

if (!Number.isFinite(gateMin) || gateMin < 0 || gateMin > 100) {
  fail(`invalid coverage gate: ${gateMin}`);
}

const rows = behaviors.map((behavior) => {
  const claimed = behavior.covered === true;
  const specRel = behavior.spec ?? '';
  const specExists = specRel ? existsSync(path.join(PKG_ROOT, specRel)) : false;
  const counted = claimed && specExists;
  const surface = surfaceById.get(behavior.surfaceId);
  return {
    id: behavior.id,
    surfaceId: behavior.surfaceId,
    surfaceKind: surface?.kind ?? 'unknown',
    title: behavior.title,
    claimed,
    spec: specRel,
    specExists,
    counted,
    rationale: behavior.rationale ?? '',
    followUp: behavior.followUp ?? null,
  };
});

const total = rows.length;
const covered = rows.filter((row) => row.counted).length;
const coveredPct = Number(((covered / total) * 100).toFixed(2));
const driftRows = rows.filter((row) => row.claimed && !row.specExists);
const uncovered = rows.filter((row) => !row.counted);

const countedSurfaceIds = new Set(rows.filter((row) => row.counted).map((row) => row.surfaceId));
const surfaceGaps = surfaces
  .filter((surface) => requiredKindSet.has(surface.kind))
  .filter((surface) => !countedSurfaceIds.has(surface.id))
  .map((surface) => ({
    id: surface.id,
    kind: surface.kind,
    title: surface.title,
    path: surface.path ?? null,
  }));

const bySurfaceKind = rows.reduce((acc, row) => {
  const current = acc[row.surfaceKind] ?? { total: 0, covered: 0 };
  current.total += 1;
  if (row.counted) current.covered += 1;
  acc[row.surfaceKind] = current;
  return acc;
}, {});

const artifact = {
  total,
  covered,
  coveredPct,
  gateMinPct: gateMin,
  bySurfaceKind,
  surfaceGaps,
  passed: coveredPct >= gateMin && driftRows.length === 0 && surfaceGaps.length === 0,
  uncovered: uncovered.map((row) => ({
    id: row.id,
    surfaceId: row.surfaceId,
    surfaceKind: row.surfaceKind,
    title: row.title,
    reason: row.claimed && !row.specExists ? 'spec-missing' : 'not-covered',
    rationale: row.rationale,
    followUp: row.followUp,
  })),
};
writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);

console.log('\nE2E behavior coverage');
for (const row of rows) {
  const mark = row.counted ? 'OK' : row.claimed && !row.specExists ? 'MISS' : 'TODO';
  console.log(`  ${mark} ${row.id} -> ${row.surfaceId}`);
}
console.log(`\nCovered ${covered}/${total} = ${coveredPct}% (gate ${gateMin}%)`);

if (driftRows.length > 0) {
  fail(
    `manifest drift - covered behaviors missing their spec file: ${driftRows
      .map((row) => row.id)
      .join(', ')}`,
  );
}
if (surfaceGaps.length > 0) {
  fail(
    `page surfaces missing covered behavior contracts: ${surfaceGaps
      .map((surface) => surface.id)
      .join(', ')}`,
  );
}
if (coveredPct < gateMin) {
  fail(`behavior coverage ${coveredPct}% < gate ${gateMin}%`);
}
console.log(`\nOK E2E behavior coverage gate passed (${coveredPct}% >= ${gateMin}%).`);
