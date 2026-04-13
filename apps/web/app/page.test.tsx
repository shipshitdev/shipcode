import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('web home page', () => {
  it('renders the main marketing headline and install CTA', () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain('Make Planning Great Again');
    expect(html).toContain('npx @shipshitdev/shipcode');
    expect(html).toContain('Copy');
  });

  it('renders the current cross-model positioning copy', () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain('Then it executes — with Claude, Codex, or any OpenRouter model.');
    expect(html).toContain('Route plan, review, execute, and verify');
  });
});
