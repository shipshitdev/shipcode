// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

const openProjectTerminalMock = vi.hoisted(() => vi.fn());

vi.mock('./useOpenProjectTerminal', () => ({
  useOpenProjectTerminal: () => ({ openProjectTerminal: openProjectTerminalMock }),
}));

import { useGlobalKeyboard } from './useGlobalKeyboard';

function KeyboardHarness() {
  useGlobalKeyboard();
  return null;
}

afterEach(() => {
  cleanup();
});

describe('useGlobalKeyboard', () => {
  const toggleCommandPalette = vi.fn();
  const toggleTerminal = vi.fn();
  const toggleSidebar = vi.fn();

  beforeEach(() => {
    toggleCommandPalette.mockReset();
    toggleTerminal.mockReset();
    toggleSidebar.mockReset();
    openProjectTerminalMock.mockReset();
    openProjectTerminalMock.mockResolvedValue(undefined);

    useAppStore.setState({
      toggleCommandPalette,
      toggleTerminal,
      toggleSidebar,
    });
  });

  it('dispatches the configured shortcut actions', () => {
    render(<KeyboardHarness />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true }));

    expect(toggleCommandPalette).toHaveBeenCalledTimes(1);
    expect(toggleTerminal).toHaveBeenCalledTimes(1);
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    expect(openProjectTerminalMock).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated key presses', () => {
    render(<KeyboardHarness />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: false }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));

    expect(toggleCommandPalette).not.toHaveBeenCalled();
    expect(toggleTerminal).not.toHaveBeenCalled();
    expect(toggleSidebar).not.toHaveBeenCalled();
  });
});
