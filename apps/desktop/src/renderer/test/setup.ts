import '@testing-library/jest-dom/vitest'

Object.defineProperty(window, 'shipcode', {
	value: {
		invoke: () => Promise.resolve(null),
		on: () => () => {},
	},
	writable: true,
})
