import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function failCoverageGate(message, mark = '✗') {
  console.error(`\n${mark} ${message}`);
  process.exit(1);
}

export function resolveCoveragePaths(moduleUrl) {
  const scriptsRoot = path.dirname(fileURLToPath(moduleUrl));
  const packageRoot = path.resolve(scriptsRoot, '..');
  return {
    packageRoot,
    repositoryRoot: path.resolve(packageRoot, '..'),
  };
}

export function readJson(filePath, missingLabel = 'manifest') {
  if (!existsSync(filePath)) {
    failCoverageGate(`${missingLabel} not found at ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function resolveGateMinimum({ env, envName, fallback, manifest }) {
  const envMin = env[envName];
  const gateMin =
    envMin !== undefined && envMin !== ''
      ? Number(envMin)
      : typeof manifest.gateMinPct === 'number'
        ? manifest.gateMinPct
        : fallback;

  if (!Number.isFinite(gateMin) || gateMin < 0 || gateMin > 100) {
    throw new RangeError(`invalid coverage gate: ${gateMin}`);
  }

  return gateMin;
}

export function buildCoverageRows({ entries, getSpecs, mapRow, packageRoot }) {
  return entries.map((entry) => {
    const claimed = entry.covered === true;
    const specStatuses = getSpecs(entry).map((spec) => ({
      spec,
      exists: spec ? existsSync(path.join(packageRoot, spec)) : false,
    }));
    const specsExist = specStatuses.length > 0 && specStatuses.every((spec) => spec.exists);
    const counted = claimed && specsExist;

    return {
      ...mapRow(entry, { claimed, counted, specStatuses, specsExist }),
      claimed,
      counted,
      specsExist,
    };
  });
}

export function summarizeCoverage(rows) {
  const total = rows.length;
  const covered = rows.filter((row) => row.counted).length;
  return {
    total,
    covered,
    coveredPct: Number(((covered / total) * 100).toFixed(2)),
    driftRows: rows.filter((row) => row.claimed && !row.specsExist),
    uncovered: rows.filter((row) => !row.counted),
  };
}

export function runCoverageGate({
  artifactPath,
  artifactAfterPassed = () => ({}),
  artifactBeforePassed = () => ({}),
  defaultGateMin,
  emptyMessage,
  entriesKey,
  envName,
  failureMark,
  formatRow,
  formatSuccess,
  getFailureMessages,
  getSpecs,
  manifestPath,
  mapUncovered,
  mapRow,
  packageRoot,
  title,
  validateEntries,
}) {
  const manifest = readJson(manifestPath);
  const entries = Array.isArray(manifest[entriesKey]) ? manifest[entriesKey] : [];
  if (entries.length === 0) failCoverageGate(emptyMessage, failureMark);
  validateEntries?.(entries, manifest);

  let gateMin;
  try {
    gateMin = resolveGateMinimum({
      env: process.env,
      envName,
      fallback: defaultGateMin,
      manifest,
    });
  } catch (error) {
    failCoverageGate(error instanceof Error ? error.message : String(error), failureMark);
  }

  const rows = buildCoverageRows({ entries, getSpecs, mapRow, packageRoot });
  const summary = summarizeCoverage(rows);
  const context = { entries, gateMin, manifest, rows, ...summary };
  const failureMessages = getFailureMessages(context).filter(Boolean);
  const passed = failureMessages.length === 0;
  const artifact = {
    total: summary.total,
    covered: summary.covered,
    coveredPct: summary.coveredPct,
    gateMinPct: gateMin,
    ...artifactBeforePassed(context),
    passed,
    ...artifactAfterPassed(context),
    uncovered: summary.uncovered.map(mapUncovered),
  };
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(`\n${title}`);
  for (const row of rows) console.log(formatRow(row));
  console.log(
    `\nCovered ${summary.covered}/${summary.total} = ${summary.coveredPct}% (gate ${gateMin}%)`,
  );

  const [failure] = failureMessages;
  if (failure) failCoverageGate(failure, failureMark);

  console.log(`\n${formatSuccess(context)}`);
  return { ...context, artifact, passed };
}
