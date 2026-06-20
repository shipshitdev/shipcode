import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DESKTOP_DIR = path.join(REPO_ROOT, 'apps', 'desktop');
const DESKTOP_MAIN = path.join(DESKTOP_DIR, 'dist', 'main', 'index.js');
const CLI_DIR = path.join(REPO_ROOT, 'apps', 'cli');
const CLI_ENTRY = path.join(CLI_DIR, 'dist', 'index.js');

/**
 * Ensure prerequisite build artifacts exist before specs run.
 *
 * The desktop project needs the compiled Electron bundle (dist/main +
 * dist/preload + dist/index.html). The CLI project needs apps/cli/dist/index.js.
 * We build each artifact only when its project is part of the current run and
 * the artifact is missing, so targeted iterations stay fast. The web/docs
 * static exports are built lazily by each web spec's static server, so they are
 * not handled here.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  // Playwright passes the FULL project list here regardless of any `--project`
  // filter, so detect the actually-selected projects from argv. Without this the
  // web-smoke-only run (`--project=web-smoke`) would still build the desktop
  // bundle — which fails on non-macOS CI runners.
  const selected = [...process.argv.join(' ').matchAll(/--project(?:=|\s+)(\S+)/g)].map(
    (match) => match[1],
  );
  const runsDesktop =
    selected.length === 0
      ? config.projects.some((project) => project.name === 'desktop')
      : selected.includes('desktop');
  const runsCli =
    selected.length === 0
      ? config.projects.some((project) => project.name === 'cli')
      : selected.includes('cli');

  if (runsCli) {
    if (existsSync(CLI_ENTRY)) {
      // eslint-disable-next-line no-console
      console.log('[e2e] CLI bundle present — skipping build');
    } else {
      // eslint-disable-next-line no-console
      console.log('[e2e] building CLI bundle (bun --filter @shipshitdev/shipcode build)…');
      execFileSync('bun', ['--filter', '@shipshitdev/shipcode', 'build'], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
      });

      if (!existsSync(CLI_ENTRY)) {
        throw new Error(`[e2e] CLI build did not produce ${CLI_ENTRY}`);
      }
    }
  }

  if (!runsDesktop) return;

  if (existsSync(DESKTOP_MAIN)) {
    // eslint-disable-next-line no-console
    console.log('[e2e] desktop bundle present — skipping build');
  } else {
    // eslint-disable-next-line no-console
    console.log('[e2e] building desktop bundle (bun --filter @shipcode/desktop build:code)…');
    execFileSync('bun', ['--filter', '@shipcode/desktop', 'build:code'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });

    if (!existsSync(DESKTOP_MAIN)) {
      throw new Error(`[e2e] desktop build did not produce ${DESKTOP_MAIN}`);
    }
  }
}
