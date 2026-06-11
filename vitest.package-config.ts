import { defineConfig, type ViteUserConfig } from 'vitest/config';
import { withCoverage } from './vitest.coverage';

type TestConfig = NonNullable<ViteUserConfig['test']>;

export function definePackageVitestConfig(test: Partial<TestConfig> = {}) {
  return defineConfig({
    test: withCoverage(
      {
        include: ['src/**/*.test.ts'],
        ...test,
      },
      ['src/**/*.{ts,tsx}'],
    ),
  });
}
