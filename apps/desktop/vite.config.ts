import { builtinModules } from 'node:module';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

const NATIVE_EXTERNALS = [
  'electron',
  'node:sqlite',
  'node-pty',
  'simple-git',
  'chokidar',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist/main',
            lib: {
              entry: 'src/main/index.ts',
              formats: ['cjs'],
              fileName: () => 'index.js',
            },
            rollupOptions: {
              external: NATIVE_EXTERNALS,
            },
            commonjsOptions: {
              ignoreDynamicRequires: true,
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist/preload',
            lib: {
              entry: 'src/preload/index.ts',
              formats: ['cjs'],
              fileName: () => 'index.js',
            },
            rollupOptions: {
              external: NATIVE_EXTERNALS,
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
});
