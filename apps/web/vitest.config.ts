import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';

export default defineConfig({
  test: withCoverage(
    {
      environment: 'node',
      include: ['app/**/*.test.ts', 'app/**/*.test.tsx'],
      exclude: ['.next/**', 'out/**'],
    },
    ['app/**/*.{ts,tsx}'],
  ),
});
