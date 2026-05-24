// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { SettingsSidebar } from './SettingsSidebar';

afterEach(() => {
  cleanup();
});

describe('SettingsSidebar', () => {
  beforeEach(() => {
    useAppStore.setState({
      settingsVisible: true,
      settingsSection: 'general',
      terminalVisible: true,
      terminalMaximized: true,
    });
  });

  it('switches the active section and closes back to the app', () => {
    render(<SettingsSidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(useAppStore.getState().settingsSection).toBe('notifications');

    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    const state = useAppStore.getState();
    expect(state.settingsVisible).toBe(false);
    expect(state.settingsSection).toBe('general');
    expect(state.terminalVisible).toBe(true);
  });

  it('marks the selected section as active', () => {
    useAppStore.setState({ settingsSection: 'pipeline' });

    render(<SettingsSidebar />);

    expect(screen.getByRole('button', { name: 'Pipeline' }).className).toContain('bg-tertiary');
    expect(screen.getByRole('button', { name: 'General' }).className).not.toContain('bg-tertiary');
  });
});
