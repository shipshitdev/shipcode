import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'shipcode', {
  value: {
    invoke: () => Promise.resolve(null),
    on: () => () => {},
  },
  writable: true,
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
