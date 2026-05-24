import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: withCoverage(
    {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      exclude: ['dist/**'],
      setupFiles: ['src/test/setup.ts'],
    },
    ['src/**/*.{ts,tsx}'],
  ),
});
