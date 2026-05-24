import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { withCoverage } from '../../vitest.coverage';
import { shipcodeUiSourceAlias } from './shipcode-ui-source-alias';

export default defineConfig({
  plugins: [
    shipcodeUiSourceAlias({
      uiSrc: path.resolve(__dirname, '../../packages/ui/src'),
      rendererSrc: path.resolve(__dirname, './src/renderer'),
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^@radix-ui\/react-compose-refs$/,
        replacement: path.resolve(__dirname, '../../packages/ui/src/vendor/radix-compose-refs.ts'),
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
