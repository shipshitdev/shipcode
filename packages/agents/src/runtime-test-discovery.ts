import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RUNTIME_TESTS_DIR = '.shipcode/runtime-tests';

const EXTENSION_RUNNERS: Record<string, (filePath: string) => string> = {
  '.test.sh': (f) => `bash ${f}`,
  '.test.ts': (f) => `bun run ${f}`,
  '.test.js': (f) => `bun run ${f}`,
};

const KNOWN_SUFFIXES = Object.keys(EXTENSION_RUNNERS);

export function discoverRuntimeTests(worktreePath: string): string[] {
  const dir = join(worktreePath, RUNTIME_TESTS_DIR);
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const commands: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    const suffix = KNOWN_SUFFIXES.find((s) => entry.name.endsWith(s));
    if (!suffix) continue;
    const filePath = join(dir, entry.name);
    commands.push(EXTENSION_RUNNERS[suffix](filePath));
  }

  return commands;
}

export function getRuntimeTestsDir(worktreePath: string): string {
  return join(worktreePath, RUNTIME_TESTS_DIR);
}
