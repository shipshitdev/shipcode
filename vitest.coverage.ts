import type { InlineConfig } from 'vitest';

const DEFAULT_COVERAGE_EXCLUDE = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.d.ts',
  '**/coverage/**',
  '**/dist/**',
  '**/out/**',
  '**/.next/**',
  '**/node_modules/**',
  '**/vitest.config.ts',
  '**/vite.config.ts',
];

export function withCoverage(test: InlineConfig, coverageInclude: string[]): InlineConfig {
  const coverage = test.coverage ?? {};

  return {
    ...test,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      all: true,
      include: coverageInclude,
      exclude: [...new Set([...(coverage.exclude ?? []), ...DEFAULT_COVERAGE_EXCLUDE])],
      ...coverage,
    },
  };
}
