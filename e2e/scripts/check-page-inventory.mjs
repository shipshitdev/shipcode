#!/usr/bin/env node
/*
 * Source-of-truth page inventory drift check.
 *
 * The page coverage manifest is intentionally hand-authored so each surface has
 * a human-readable title and spec rationale. This script prevents it from
 * drifting behind the app by deriving the expected page inventory from:
 * - desktop app store view/tab/settings unions,
 * - issue-detail tab union,
 * - docs content routes,
 * - the web landing route.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..');
const PAGE_MANIFEST = path.join(PKG_ROOT, 'page-coverage.manifest.json');
const ARTIFACT = path.join(PKG_ROOT, 'e2e-page-inventory.json');
const APP_STORE = path.join(
  REPO_ROOT,
  'apps',
  'desktop',
  'src',
  'renderer',
  'stores',
  'app-store.ts',
);
const ISSUE_TABS = path.join(
  REPO_ROOT,
  'apps',
  'desktop',
  'src',
  'renderer',
  'components',
  'issue-detail',
  'tab-types.ts',
);
const DOCS_CONTENT = path.join(REPO_ROOT, 'apps', 'docs', 'content');

function fail(message) {
  console.error(`\nFAIL ${message}`);
  process.exit(1);
}

function readJson(file) {
  if (!existsSync(file)) fail(`manifest not found at ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function unionValues(file, typeName) {
  const source = readFileSync(file, 'utf8');
  const match = source.match(new RegExp(`(?:export\\s+)?type\\s+${typeName}\\s*=([\\s\\S]*?);`));
  if (!match) fail(`could not find type ${typeName} in ${file}`);
  return Array.from(match[1].matchAll(/'([^']+)'/g), (item) => item[1]);
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function docsRouteFromRelative(relativeFile) {
  const withoutExt = relativeFile.replace(/\.mdx$/, '');
  if (withoutExt === 'index') return '/';
  if (withoutExt.endsWith('/index')) {
    return `/${withoutExt.slice(0, -'/index'.length)}`;
  }
  return `/${withoutExt}`;
}

function docsIdFromRelative(relativeFile) {
  const withoutExt = relativeFile.replace(/\.mdx$/, '').replaceAll(path.sep, '-');
  return withoutExt === 'index' ? 'docs-index' : `docs-${withoutExt}`;
}

function pageSurfaceExpected() {
  const viewModes = unionValues(APP_STORE, 'ViewMode');
  const projectTabs = unionValues(APP_STORE, 'ProjectTab');
  const settingsSections = unionValues(APP_STORE, 'SettingsSection');
  const issueTabs = unionValues(ISSUE_TABS, 'IssueDetailTab');
  const docsFiles = walkFiles(DOCS_CONTENT)
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => path.relative(DOCS_CONTENT, file))
    .sort();

  return [
    ...viewModes
      .filter((mode) => mode !== 'project')
      .map((mode) => ({ id: `desktop-${mode}`, kind: 'desktop-view' })),
    ...projectTabs.map((tab) => ({ id: `project-${tab}`, kind: 'project-tab' })),
    ...settingsSections.map((section) => ({ id: `settings-${section}`, kind: 'settings-section' })),
    ...issueTabs.map((tab) => ({ id: `issue-tab-${tab}`, kind: 'issue-tab' })),
    { id: 'web-home', kind: 'web-route', path: '/' },
    { id: 'web-download', kind: 'web-route', path: '/download' },
    ...docsFiles.map((relativeFile) => ({
      id: docsIdFromRelative(relativeFile),
      kind: 'docs-route',
      path: docsRouteFromRelative(relativeFile),
    })),
  ];
}

const pageManifest = readJson(PAGE_MANIFEST);
const surfaces = Array.isArray(pageManifest.surfaces) ? pageManifest.surfaces : [];
if (surfaces.length === 0) fail('page manifest contains no surfaces');

const expected = pageSurfaceExpected();
const expectedById = new Map(expected.map((surface) => [surface.id, surface]));
const actualById = new Map(surfaces.map((surface) => [surface.id, surface]));

const missing = expected.filter((surface) => !actualById.has(surface.id));
const extra = surfaces
  .filter((surface) => expectedById.has(surface.id) === false)
  .map((surface) => ({ id: surface.id, kind: surface.kind, path: surface.path ?? null }));
const kindMismatches = expected
  .filter((surface) => actualById.has(surface.id))
  .filter((surface) => actualById.get(surface.id).kind !== surface.kind)
  .map((surface) => ({
    id: surface.id,
    expected: surface.kind,
    actual: actualById.get(surface.id).kind,
  }));
const pathMismatches = expected
  .filter((surface) => surface.path !== undefined)
  .filter((surface) => actualById.has(surface.id))
  .filter((surface) => (actualById.get(surface.id).path ?? null) !== surface.path)
  .map((surface) => ({
    id: surface.id,
    expected: surface.path,
    actual: actualById.get(surface.id).path ?? null,
  }));

const artifact = {
  expected: expected.length,
  actual: surfaces.length,
  passed:
    missing.length === 0 &&
    extra.length === 0 &&
    kindMismatches.length === 0 &&
    pathMismatches.length === 0,
  missing,
  extra,
  kindMismatches,
  pathMismatches,
};
writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);

console.log('\nE2E page inventory');
console.log(`  expected: ${expected.length}`);
console.log(`  manifest: ${surfaces.length}`);

if (missing.length > 0)
  fail(`manifest missing surfaces: ${missing.map((row) => row.id).join(', ')}`);
if (extra.length > 0)
  fail(`manifest has stale/unknown surfaces: ${extra.map((row) => row.id).join(', ')}`);
if (kindMismatches.length > 0) {
  fail(`manifest surface kind mismatches: ${kindMismatches.map((row) => row.id).join(', ')}`);
}
if (pathMismatches.length > 0) {
  fail(`manifest route path mismatches: ${pathMismatches.map((row) => row.id).join(', ')}`);
}

console.log('\nOK E2E page inventory matches app/docs source.');
