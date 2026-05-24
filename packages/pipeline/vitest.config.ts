import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';

export default defineConfig({
  test: withCoverage(
    {
      include: ['src/**/*.test.ts'],
    },
    ['src/**/*.{ts,tsx}'],
  ),
});
