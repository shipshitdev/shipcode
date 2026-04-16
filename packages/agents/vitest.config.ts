import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';

export default defineConfig({
  test: withCoverage(
    {
      include: ['src/**/*.test.ts'],
      // Quarantined: this spec currently leaves Vitest workers hanging after completion.
      exclude: ['src/providers/openrouter-http.test.ts'],
    },
    ['src/**/*.{ts,tsx}'],
  ),
});
