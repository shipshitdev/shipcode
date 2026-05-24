// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shikiState = vi.hoisted(() => ({
  createHighlighter: vi.fn(),
  createJavaScriptRegexEngine: vi.fn(() => ({ engine: 'regex' })),
  loadLanguage: vi.fn(),
  codeToTokens: vi.fn(),
}));

vi.mock('shiki', () => ({
  createHighlighter: shikiState.createHighlighter,
  createJavaScriptRegexEngine: shikiState.createJavaScriptRegexEngine,
}));

import { SyntaxHighlightedCode, SyntaxHighlightedLine } from './SyntaxHighlightedCode';
import { languageFromFilePath, useSyntaxHighlightedLines } from './syntax-highlighting';

function renderIntoDom(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    rerender: (next: ReactNode) => {
      act(() => {
        root.render(next);
      });
    },
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function HighlightedLinesHarness({ lines, filePath }: { lines: string[]; filePath?: string }) {
  return <div>{useSyntaxHighlightedLines(lines, filePath)}</div>;
}

describe('SyntaxHighlightedCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shikiState.loadLanguage.mockResolvedValue(undefined);
    shikiState.codeToTokens.mockReturnValue({
      tokens: [
        [
          { content: 'const', color: '#569cd6', fontStyle: 1 },
          { content: ' value', color: '#dcdcaa', fontStyle: 6 },
        ],
        [],
      ],
    });
    shikiState.createHighlighter.mockResolvedValue({
      loadLanguage: shikiState.loadLanguage,
      codeToTokens: shikiState.codeToTokens,
    });
  });

  it('resolves languages from file paths and known aliases', () => {
    expect(languageFromFilePath(undefined)).toBe('text');
    expect(languageFromFilePath('/repo/Dockerfile')).toBe('dockerfile');
    expect(languageFromFilePath('/repo/Makefile')).toBe('make');
    expect(languageFromFilePath('/repo/src/index.ts')).toBe('typescript');
    expect(languageFromFilePath('/repo/README.md')).toBe('markdown');
    expect(languageFromFilePath('/repo/no-extension')).toBe('text');
    expect(languageFromFilePath('/repo/archive.unknown')).toBe('text');
  });

  it('renders plain text without loading shiki for empty or text-only input', async () => {
    const view = renderIntoDom(
      <SyntaxHighlightedCode code={'plain\n'} filePath="notes.txt" className="extra" />,
    );

    await flushEffects();

    expect(view.container.querySelector('pre')?.className).toContain('extra');
    expect(view.container.textContent).toContain('plain');
    expect(shikiState.createHighlighter).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('short-circuits highlighting for empty source even when a code language is supplied', async () => {
    const view = renderIntoDom(<SyntaxHighlightedCode code="" language="ts" />);

    await flushEffects();

    expect(view.container.textContent).toBe('\u00A0');
    expect(shikiState.createHighlighter).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('renders non-empty source as plain text when no language or file path is supplied', async () => {
    const view = renderIntoDom(<SyntaxHighlightedCode code="plain text" />);

    await flushEffects();

    expect(view.container.textContent).toContain('plain text');
    expect(shikiState.createHighlighter).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('loads a language once, renders token styles, and uses nonbreaking space for empty lines', async () => {
    const view = renderIntoDom(<SyntaxHighlightedCode code={'const value\n'} language="ts" />);

    await flushEffects();

    expect(shikiState.createJavaScriptRegexEngine).toHaveBeenCalledWith({ forgiving: true });
    expect(shikiState.loadLanguage).toHaveBeenCalledWith('typescript');
    expect(shikiState.codeToTokens).toHaveBeenCalledWith('const value\n', {
      lang: 'typescript',
      theme: 'dark-plus',
    });

    const spans = Array.from(view.container.querySelectorAll('span'));
    expect(spans[0].getAttribute('style')).toContain('font-style: italic');
    expect(spans[1].getAttribute('style')).toContain('font-weight: 600');
    expect(spans[1].getAttribute('style')).toContain('text-decoration: underline');
    expect(view.container.textContent).toContain('\u00A0');

    view.rerender(<SyntaxHighlightedCode code={'const value\n'} language="ts" />);
    await flushEffects();
    expect(shikiState.loadLanguage).toHaveBeenCalledTimes(1);

    view.cleanup();
  });

  it('renders a single highlighted line and hook-rendered highlighted lines', async () => {
    const lineView = renderIntoDom(<SyntaxHighlightedLine code="const value" language="js" />);
    await flushEffects();

    expect(shikiState.loadLanguage).toHaveBeenCalledWith('javascript');
    expect(lineView.container.textContent).toContain('const value');
    lineView.cleanup();

    const hookView = renderIntoDom(
      <HighlightedLinesHarness lines={['const value', '']} filePath="snippet.mdx" />,
    );
    await flushEffects();

    expect(shikiState.loadLanguage).toHaveBeenCalledWith('mdx');
    expect(hookView.container.textContent).toContain('const value');
    expect(hookView.container.textContent).toContain('\u00A0');
    hookView.cleanup();
  });

  it('normalizes explicit language variants and empty language props', async () => {
    const markdownView = renderIntoDom(<SyntaxHighlightedCode code="# Title" language="md" />);
    await flushEffects();

    expect(shikiState.loadLanguage).toHaveBeenCalledWith('markdown');
    markdownView.cleanup();

    const explicitView = renderIntoDom(<SyntaxHighlightedCode code="<main />" language="tsx" />);
    await flushEffects();

    expect(shikiState.loadLanguage).toHaveBeenCalledWith('tsx');
    explicitView.cleanup();

    const directLanguageView = renderIntoDom(
      <SyntaxHighlightedLine code="print('hello')" language="python" />,
    );
    await flushEffects();

    expect(shikiState.loadLanguage).toHaveBeenCalledWith('python');
    directLanguageView.cleanup();

    const emptyLanguageView = renderIntoDom(
      <SyntaxHighlightedLine code="plain text" language="" className="line-shell" />,
    );
    await flushEffects();

    expect(emptyLanguageView.container.textContent).toBe('plain text');
    expect(emptyLanguageView.container.querySelector('.line-shell')).not.toBeNull();
    emptyLanguageView.cleanup();
  });

  it('skips state updates after a highlighted component unmounts', async () => {
    let resolveLoadLanguage: (() => void) | undefined;
    shikiState.loadLanguage.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLoadLanguage = resolve;
      }),
    );

    const view = renderIntoDom(<SyntaxHighlightedCode code=".root {}" language="scss" />);
    view.cleanup();

    await act(async () => {
      resolveLoadLanguage?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(shikiState.loadLanguage).toHaveBeenCalledWith('scss');
  });

  it('skips failed-highlighting state updates after unmount', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let rejectLoadLanguage: ((error: Error) => void) | undefined;
    shikiState.loadLanguage.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectLoadLanguage = reject;
      }),
    );

    const view = renderIntoDom(<SyntaxHighlightedCode code=".root {}" language="css" />);
    view.cleanup();

    await act(async () => {
      rejectLoadLanguage?.(new Error('missing css'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(shikiState.loadLanguage).toHaveBeenCalledWith('css');
    expect(warn).toHaveBeenCalledWith('Syntax highlighting failed', expect.any(Error));
    warn.mockRestore();
  });

  it('falls back to source text and logs in development when highlighting fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    shikiState.loadLanguage.mockRejectedValueOnce(new Error('missing language'));

    const view = renderIntoDom(<SyntaxHighlightedCode code="key: value" filePath="config.yaml" />);
    await flushEffects();

    expect(view.container.textContent).toBe('key: value');
    expect(warn).toHaveBeenCalledWith('Syntax highlighting failed', expect.any(Error));

    warn.mockRestore();
    view.cleanup();
  });

  it('suppresses highlighting failure logs in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    shikiState.loadLanguage.mockRejectedValueOnce(new Error('production missing language'));

    const view = renderIntoDom(<SyntaxHighlightedCode code="<main />" filePath="index.html" />);
    await flushEffects();

    expect(view.container.textContent).toBe('<main />');
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
    process.env.NODE_ENV = originalEnv;
    view.cleanup();
  });
});
