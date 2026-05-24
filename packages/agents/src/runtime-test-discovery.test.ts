import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverRuntimeTests, getRuntimeTestsDir } from './runtime-test-discovery';

describe('discoverRuntimeTests', () => {
  let root: string;
  let testsDir: string;

  beforeEach(() => {
    root = join(tmpdir(), `rt-disc-${Date.now()}`);
    testsDir = join(root, '.shipcode', 'runtime-tests');
    mkdirSync(testsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it('returns empty array when directory does not exist', () => {
    rmSync(testsDir, { recursive: true, force: true });
    expect(discoverRuntimeTests(root)).toEqual([]);
  });

  it('discovers .test.sh files with bash runner', () => {
    writeFileSync(join(testsDir, 'smoke.test.sh'), '#!/bin/bash\ncurl $BASE_URL');
    const result = discoverRuntimeTests(root);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(`bash ${join(testsDir, 'smoke.test.sh')}`);
  });

  it('discovers .test.ts files with bun runner', () => {
    writeFileSync(join(testsDir, 'api.test.ts'), 'console.log("test")');
    const result = discoverRuntimeTests(root);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(`bun run ${join(testsDir, 'api.test.ts')}`);
  });

  it('discovers .test.js files with bun runner', () => {
    writeFileSync(join(testsDir, 'check.test.js'), 'console.log("test")');
    const result = discoverRuntimeTests(root);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(`bun run ${join(testsDir, 'check.test.js')}`);
  });

  it('ignores files without known test suffixes', () => {
    writeFileSync(join(testsDir, 'readme.md'), '# docs');
    writeFileSync(join(testsDir, 'helper.ts'), 'export const x = 1;');
    writeFileSync(join(testsDir, 'data.json'), '{}');
    expect(discoverRuntimeTests(root)).toEqual([]);
  });

  it('ignores subdirectories', () => {
    mkdirSync(join(testsDir, 'nested.test.ts'), { recursive: true });
    expect(discoverRuntimeTests(root)).toEqual([]);
  });

  it('sorts files lexicographically', () => {
    writeFileSync(join(testsDir, 'c-auth.test.ts'), '');
    writeFileSync(join(testsDir, 'a-health.test.sh'), '');
    writeFileSync(join(testsDir, 'b-api.test.js'), '');
    const result = discoverRuntimeTests(root);
    expect(result).toEqual([
      `bash ${join(testsDir, 'a-health.test.sh')}`,
      `bun run ${join(testsDir, 'b-api.test.js')}`,
      `bun run ${join(testsDir, 'c-auth.test.ts')}`,
    ]);
  });

  it('handles mixed valid and invalid files', () => {
    writeFileSync(join(testsDir, 'valid.test.ts'), '');
    writeFileSync(join(testsDir, 'invalid.txt'), '');
    writeFileSync(join(testsDir, 'also-valid.test.sh'), '');
    const result = discoverRuntimeTests(root);
    expect(result).toHaveLength(2);
  });
});

describe('getRuntimeTestsDir', () => {
  it('returns correct path', () => {
    expect(getRuntimeTestsDir('/project')).toBe('/project/.shipcode/runtime-tests');
  });
});
