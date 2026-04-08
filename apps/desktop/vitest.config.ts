import { defineConfig } from 'vitest/config'

export default defineConfig({
	root: '.',
	test: {
		environment: 'jsdom',
		include: ['apps/desktop/src/**/*.test.ts', 'apps/desktop/src/**/*.test.tsx'],
		setupFiles: ['apps/desktop/src/renderer/test/setup.ts'],
	},
})
