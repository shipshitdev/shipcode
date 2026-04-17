// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusPill } from './StatusPill';

afterEach(() => {
  cleanup();
});

describe('StatusPill', () => {
  it.each([
    ['success', 'border-emerald-500/30'],
    ['warning', 'border-amber-500/30'],
    ['danger', 'border-red-500/30'],
    ['neutral', 'border-border'],
  ] as const)('renders the %s tone classes', (tone, expectedClass) => {
    render(<StatusPill tone={tone}>Ready</StatusPill>);

    const pill = screen.getByText('Ready');
    expect(pill.className).toContain(expectedClass);
  });
});
