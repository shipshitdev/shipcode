import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'browser',
  dts: true,
  sourcemap: false,
  clean: true,
  banner: {
    js: '"use client";',
  },
  external: ['react', 'react-dom'],
  noExternal: ['@shipcode/shared'],
});
