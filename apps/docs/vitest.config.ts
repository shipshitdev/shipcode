import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';

export default defineConfig({
  test: withCoverage(
    {
      environment: 'node',
      include: ['**/*.test.ts', '**/*.test.tsx'],
      exclude: ['.next/**', 'out/**'],
    },
    ['**/*.{ts,tsx}'],
  ),
});
