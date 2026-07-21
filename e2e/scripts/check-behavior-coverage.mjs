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
import path from 'node:path';
import {
  failCoverageGate,
  readJson,
  resolveCoveragePaths,
  runCoverageGate,
} from './lib/coverage-gate.mjs';

const { packageRoot: PKG_ROOT } = resolveCoveragePaths(import.meta.url);
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

const pageManifest = readJson(PAGE_MANIFEST);
const surfaces = Array.isArray(pageManifest.surfaces) ? pageManifest.surfaces : [];

if (surfaces.length === 0) failCoverageGate('page manifest contains no surfaces', 'FAIL');

const surfaceById = new Map();
for (const surface of surfaces) {
  if (!surface.id || typeof surface.id !== 'string') {
    failCoverageGate('surface is missing a string id', 'FAIL');
  }
  surfaceById.set(surface.id, surface);
}

let requiredKindSet;
let surfaceGaps;

runCoverageGate({
  artifactPath: ARTIFACT,
  artifactBeforePassed: ({ rows }) => {
    const bySurfaceKind = rows.reduce((acc, row) => {
      const current = acc[row.surfaceKind] ?? { total: 0, covered: 0 };
      current.total += 1;
      if (row.counted) current.covered += 1;
      acc[row.surfaceKind] = current;
      return acc;
    }, {});
    return { bySurfaceKind, surfaceGaps };
  },
  defaultGateMin: 100,
  emptyMessage: 'manifest contains no behaviors',
  entriesKey: 'behaviors',
  envName: 'E2E_BEHAVIOR_COVERAGE_MIN',
  failureMark: 'FAIL',
  formatRow: (row) => {
    const mark = row.counted ? 'OK' : row.claimed && !row.specExists ? 'MISS' : 'TODO';
    return `  ${mark} ${row.id} -> ${row.surfaceId}`;
  },
  formatSuccess: ({ coveredPct, gateMin }) =>
    `OK E2E behavior coverage gate passed (${coveredPct}% >= ${gateMin}%).`,
  getFailureMessages: ({ coveredPct, driftRows, gateMin, rows }) => {
    const countedSurfaceIds = new Set(
      rows.filter((row) => row.counted).map((row) => row.surfaceId),
    );
    surfaceGaps = surfaces
      .filter((surface) => requiredKindSet.has(surface.kind))
      .filter((surface) => !countedSurfaceIds.has(surface.id))
      .map((surface) => ({
        id: surface.id,
        kind: surface.kind,
        title: surface.title,
        path: surface.path ?? null,
      }));
    return [
      driftRows.length > 0
        ? `manifest drift - covered behaviors missing their spec file: ${driftRows.map((row) => row.id).join(', ')}`
        : null,
      surfaceGaps.length > 0
        ? `page surfaces missing covered behavior contracts: ${surfaceGaps.map((surface) => surface.id).join(', ')}`
        : null,
      coveredPct < gateMin ? `behavior coverage ${coveredPct}% < gate ${gateMin}%` : null,
    ];
  },
  getSpecs: (behavior) => [behavior.spec ?? ''],
  manifestPath: BEHAVIOR_MANIFEST,
  mapUncovered: (row) => ({
    id: row.id,
    surfaceId: row.surfaceId,
    surfaceKind: row.surfaceKind,
    title: row.title,
    reason: row.claimed && !row.specExists ? 'spec-missing' : 'not-covered',
    rationale: row.rationale,
    followUp: row.followUp,
  }),
  mapRow: (behavior, { specStatuses }) => ({
    id: behavior.id,
    surfaceId: behavior.surfaceId,
    surfaceKind: surfaceById.get(behavior.surfaceId)?.kind ?? 'unknown',
    title: behavior.title,
    spec: specStatuses[0].spec,
    specExists: specStatuses[0].exists,
    rationale: behavior.rationale ?? '',
    followUp: behavior.followUp ?? null,
  }),
  packageRoot: PKG_ROOT,
  title: 'E2E behavior coverage',
  validateEntries: (behaviors, manifest) => {
    const requiredSurfaceKinds = Array.isArray(manifest.requiredSurfaceKinds)
      ? manifest.requiredSurfaceKinds
      : DEFAULT_REQUIRED_SURFACE_KINDS;
    requiredKindSet = new Set(requiredSurfaceKinds);

    const ids = new Set();
    for (const behavior of behaviors) {
      if (!behavior.id || typeof behavior.id !== 'string') {
        failCoverageGate('behavior is missing a string id', 'FAIL');
      }
      if (ids.has(behavior.id)) failCoverageGate(`duplicate behavior id: ${behavior.id}`, 'FAIL');
      ids.add(behavior.id);
      if (!behavior.surfaceId || typeof behavior.surfaceId !== 'string') {
        failCoverageGate(`${behavior.id} is missing surfaceId`, 'FAIL');
      }
      if (!surfaceById.has(behavior.surfaceId)) {
        failCoverageGate(
          `${behavior.id} references unknown surfaceId: ${behavior.surfaceId}`,
          'FAIL',
        );
      }
      if (!behavior.title || typeof behavior.title !== 'string') {
        failCoverageGate(`${behavior.id} is missing title`, 'FAIL');
      }
    }
  },
});
