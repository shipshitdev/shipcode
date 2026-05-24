import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['yaml'],
  noExternal: [
    '@shipcode/shared',
    '@shipcode/db',
    '@shipcode/git',
    '@shipcode/agents',
    '@shipcode/pipeline',
  ],
  async onSuccess() {
    // esbuild strips 'node:' prefix from node:sqlite because it doesn't
    // recognise it as a built-in yet. Patch the output to restore it.
    const out = path.resolve('dist/index.js');
    const code = fs.readFileSync(out, 'utf8');
    fs.writeFileSync(out, code.replaceAll('from "sqlite"', 'from "node:sqlite"'));
  },
});
