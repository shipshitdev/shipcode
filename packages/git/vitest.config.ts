import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';

export default defineConfig({
  test: withCoverage(
    {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      exclude: ['dist/**'],
    },
    ['src/**/*.{ts,tsx}'],
  ),
});
