import { describe, expect, it, vi } from 'vitest';

vi.mock('nextra-theme-docs', () => ({
  useMDXComponents: () => ({
    h1: () => 'theme-h1',
    p: () => 'theme-p',
  }),
}));

import { useMDXComponents } from './mdx-components';

describe('useMDXComponents', () => {
  it('merges theme components with caller overrides', () => {
    const customH1 = () => 'custom-h1';
    const components = useMDXComponents({ h1: customH1 });

    expect(components.h1).toBe(customH1);
    expect(typeof components.p).toBe('function');
  });
});
