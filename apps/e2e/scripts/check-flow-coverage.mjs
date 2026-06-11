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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const MANIFEST = path.join(PKG_ROOT, 'flow-coverage.manifest.json');
const ARTIFACT = path.join(PKG_ROOT, 'e2e-flow-coverage.json');

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!existsSync(MANIFEST)) fail(`manifest not found at ${MANIFEST}`);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const flows = Array.isArray(manifest.flows) ? manifest.flows : [];
if (flows.length === 0) fail('manifest contains no flows');

const envMin = process.env.E2E_FLOW_COVERAGE_MIN;
const gateMin =
  envMin !== undefined && envMin !== ''
    ? Number(envMin)
    : typeof manifest.gateMinPct === 'number'
      ? manifest.gateMinPct
      : 80;

if (!Number.isFinite(gateMin) || gateMin < 0 || gateMin > 100) {
  fail(`invalid coverage gate: ${gateMin}`);
}

const rows = flows.map((flow) => {
  const claimed = flow.covered === true;
  const specRel = flow.spec ?? '';
  const specExists = specRel ? existsSync(path.join(PKG_ROOT, specRel)) : false;
  const counted = claimed && specExists;
  return {
    id: flow.id,
    title: flow.title,
    claimed,
    spec: specRel,
    specExists,
    counted,
    rationale: flow.rationale ?? '',
    followUp: flow.followUp ?? null,
  };
});

const total = rows.length;
const covered = rows.filter((row) => row.counted).length;
const coveredPct = Number(((covered / total) * 100).toFixed(2));
const driftRows = rows.filter((row) => row.claimed && !row.specExists);
const uncovered = rows.filter((row) => !row.counted);

const artifact = {
  total,
  covered,
  coveredPct,
  gateMinPct: gateMin,
  passed: coveredPct >= gateMin && driftRows.length === 0,
  uncovered: uncovered.map((row) => ({
    id: row.id,
    title: row.title,
    reason: row.claimed && !row.specExists ? 'spec-missing' : 'not-covered',
    rationale: row.rationale,
    followUp: row.followUp,
  })),
};
writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);

console.log('\nE2E flow coverage');
for (const row of rows) {
  const mark = row.counted ? '✓' : row.claimed && !row.specExists ? '⚠' : '·';
  console.log(`  ${mark} ${row.id}${row.counted ? '' : `  (${row.spec || 'no spec'})`}`);
}
console.log(`\nCovered ${covered}/${total} = ${coveredPct}% (gate ${gateMin}%)`);

if (driftRows.length > 0) {
  fail(
    `manifest drift — covered flows missing their spec file: ${driftRows.map((row) => row.id).join(', ')}`,
  );
}
if (coveredPct < gateMin) {
  fail(`flow coverage ${coveredPct}% < gate ${gateMin}%`);
}
console.log(`\n✓ E2E flow coverage gate passed (${coveredPct}% ≥ ${gateMin}%).`);
