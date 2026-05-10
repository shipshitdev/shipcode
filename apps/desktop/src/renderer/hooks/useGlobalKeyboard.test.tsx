// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { useToastStore } from '../stores/toast-store';

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
  const selectIssue = vi.fn();
  const openCreateIssueModal = vi.fn();

  beforeEach(() => {
    toggleCommandPalette.mockReset();
    toggleTerminal.mockReset();
    toggleSidebar.mockReset();
    selectIssue.mockReset();
    openCreateIssueModal.mockReset();
    openProjectTerminalMock.mockReset();
    openProjectTerminalMock.mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });

    useAppStore.setState({
      activeIssue: null,
      activeAutomationThreadId: null,
      toggleCommandPalette,
      toggleTerminal,
      toggleSidebar,
      selectIssue,
      openCreateIssueModal,
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

  it('suppresses typing-field shortcuts except command palette', () => {
    render(<KeyboardHarness />);
    const input = document.createElement('input');
    document.body.append(input);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(editable);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }));
    editable.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }),
    );
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));

    expect(toggleTerminal).not.toHaveBeenCalled();
    expect(toggleSidebar).not.toHaveBeenCalled();
    expect(toggleCommandPalette).toHaveBeenCalledTimes(1);

    input.remove();
    editable.remove();
  });

  it('routes issue-detail, sidebar detail-view no-op, and new issue shortcuts', () => {
    useAppStore.setState({
      activeIssue: { id: 'issue-1' } as never,
    });
    render(<KeyboardHarness />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, altKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true }));

    expect(selectIssue).toHaveBeenCalledWith(null);
    expect(toggleSidebar).not.toHaveBeenCalled();
    expect(openCreateIssueModal).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast when opening the project terminal fails', async () => {
    openProjectTerminalMock.mockRejectedValueOnce(new Error('terminal denied'));
    render(<KeyboardHarness />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true }));
    await Promise.resolve();

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      kind: 'error',
      title: 'Failed to open terminal',
      body: 'terminal denied',
    });
  });
});
