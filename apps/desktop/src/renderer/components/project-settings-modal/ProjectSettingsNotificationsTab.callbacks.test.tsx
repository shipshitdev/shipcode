// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsNotificationsTab } from './ProjectSettingsNotificationsTab';

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();

  return {
    ...actual,
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-select-value={value}>
        {children}
        {['inherit', 'disabled', 'custom'].map((next) => (
          <button
            key={next}
            type="button"
            data-testid={`select-${value}-${next}`}
            onClick={() => onValueChange(next)}
          >
            select {next}
          </button>
        ))}
      </div>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode; value: string }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span />,
  };
});

afterEach(() => {
  cleanup();
});

describe('ProjectSettingsNotificationsTab callback coverage', () => {
  it('hides custom fields for inherited routing and forwards routing changes', () => {
    const onDiscordRoutingChange = vi.fn();
    const onTelegramRoutingChange = vi.fn();

    render(
      <ProjectSettingsNotificationsTab
        discordRouting="inherit"
        discordWebhookUrlOverride=""
        telegramRouting="disabled"
        telegramChatIdOverride=""
        notifyGithubUser=""
        onDiscordRoutingChange={onDiscordRoutingChange}
        onDiscordWebhookChange={vi.fn()}
        onTelegramRoutingChange={onTelegramRoutingChange}
        onTelegramChatIdChange={vi.fn()}
        onNotifyGithubUserChange={vi.fn()}
      />,
    );

    expect(screen.queryByPlaceholderText('https://discord.com/api/webhooks/...')).toBeNull();
    expect(screen.queryByPlaceholderText('-1001234567890')).toBeNull();

    fireEvent.click(screen.getAllByTestId('select-inherit-custom')[0]);
    fireEvent.click(screen.getAllByTestId('select-disabled-inherit')[0]);

    expect(onDiscordRoutingChange).toHaveBeenCalledWith('custom');
    expect(onTelegramRoutingChange).toHaveBeenCalledWith('inherit');
  });
});
