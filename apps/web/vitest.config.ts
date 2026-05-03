import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
    },
  },
  test: withCoverage(
    {
      environment: 'node',
      include: ['app/**/*.test.ts', 'app/**/*.test.tsx'],
      exclude: ['.next/**', 'out/**'],
      setupFiles: ['app/test/setup.ts'],
    },
    ['app/**/*.{ts,tsx}'],
  ),
});
