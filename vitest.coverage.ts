import type { ViteUserConfig } from 'vitest/config';

type TestConfig = NonNullable<ViteUserConfig['test']>;

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

export function withCoverage(test: TestConfig, coverageInclude: string[]): TestConfig {
  const coverage = test.coverage ?? {};

  return {
    ...test,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: coverageInclude,
      exclude: [...new Set([...(coverage.exclude ?? []), ...DEFAULT_COVERAGE_EXCLUDE])],
      ...coverage,
    },
  };
}
