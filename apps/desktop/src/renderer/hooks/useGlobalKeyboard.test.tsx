// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

const startInstantShellMock = vi.hoisted(() => vi.fn());

vi.mock('./useStartInstantShell', () => ({
  useStartInstantShell: () => ({ startInstantShell: startInstantShellMock }),
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
  const toggleIssueDetail = vi.fn();

  beforeEach(() => {
    toggleCommandPalette.mockReset();
    toggleTerminal.mockReset();
    toggleSidebar.mockReset();
    toggleIssueDetail.mockReset();
    startInstantShellMock.mockReset();
    startInstantShellMock.mockResolvedValue('thread-1');

    useAppStore.setState({
      toggleCommandPalette,
      toggleTerminal,
      toggleSidebar,
      toggleIssueDetail,
    });
  });

  it('dispatches the configured shortcut actions', () => {
    render(<KeyboardHarness />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '∫', metaKey: true, altKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', metaKey: true, shiftKey: true }));

    expect(toggleCommandPalette).toHaveBeenCalledTimes(1);
    expect(toggleTerminal).toHaveBeenCalledTimes(1);
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    expect(toggleIssueDetail).toHaveBeenCalledTimes(1);
    expect(startInstantShellMock).toHaveBeenCalledWith('claude');
    expect(startInstantShellMock).toHaveBeenCalledWith('codex');
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
    expect(toggleIssueDetail).not.toHaveBeenCalled();
  });
});
