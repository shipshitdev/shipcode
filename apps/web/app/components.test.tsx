// @vitest-environment jsdom

import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { InstallCommand } from '@/components/InstallCommand';

vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'font-inter' }),
  JetBrains_Mono: () => ({ variable: 'font-jetbrains' }),
}));

import RootLayout, { metadata } from '@/layout';

function renderIntoDom(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      document.body.innerHTML = '';
    },
  };
}

describe('web component coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the marketing layout metadata and font classes', () => {
    expect(metadata.title).toBe('ShipCode — Autonomous AI Coding Pipeline');
    expect(metadata.description).toContain('Desktop app + CLI');

    const html = renderToStaticMarkup(
      <RootLayout>
        <main>Landing</main>
      </RootLayout>,
    );

    expect(html).toContain('class="font-inter font-jetbrains"');
    expect(html).toContain('Landing');
    expect(html).toContain('bg-primary text-primary antialiased');
  });

  it('toggles the header chrome after scrolling', () => {
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      writable: true,
      value: 0,
    });

    const view = renderIntoDom(<Header />);
    expect(view.container.firstElementChild?.className).toContain('bg-transparent');
    expect(view.container.textContent).toContain('ShipCode');
    expect(view.container.textContent).toContain('Docs');
    expect(view.container.textContent).toContain('GitHub');
    expect(view.container.innerHTML).toContain('x="184" y="192" width="176" height="500"');
    expect(view.container.innerHTML).toContain('x="424" y="192" width="176" height="560"');

    act(() => {
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        writable: true,
        value: 40,
      });
      window.dispatchEvent(new Event('scroll'));
    });

    expect(view.container.firstElementChild?.className).toContain('bg-primary/70');
    view.cleanup();
  });

  it('copies the active install command and resets the button label after the timeout', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const view = renderIntoDom(<InstallCommand compact />);
    const button = Array.from(view.container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Copy'),
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected copy button');
    }

    await act(async () => {
      button.click();
    });

    expect(writeText).toHaveBeenCalledWith('brew install --cask shipshitdev/tap/shipcode');
    expect(button.textContent).toBe('Copied!');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(button.textContent).toBe('Copy');

    const cliButton = Array.from(view.container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('CLI'),
    );
    if (!(cliButton instanceof HTMLButtonElement)) {
      throw new Error('Expected CLI button');
    }

    await act(async () => {
      cliButton.click();
    });

    await act(async () => {
      button.click();
    });

    expect(writeText).toHaveBeenLastCalledWith('npx @shipshitdev/shipcode run 42');
    view.cleanup();
    vi.useRealTimers();
  });

  it('renders the footer links', () => {
    const html = renderToStaticMarkup(<Footer />);

    expect(html).toContain('© 2026 shipshit.dev');
    expect(html).toContain('https://github.com/shipshitdev/shipcode');
    expect(html).toContain('/docs');
  });
});
