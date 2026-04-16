import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@radix-ui\/react-compose-refs$/,
        replacement: path.resolve(__dirname, '../../packages/ui/src/vendor/radix-compose-refs.ts'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src/renderer'),
      },
    ],
  },
  test: withCoverage(
    {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['src/renderer/test/setup.ts'],
      passWithNoTests: true,
    },
    ['src/**/*.{ts,tsx}'],
  ),
});
