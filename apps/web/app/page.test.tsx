import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Home from '@/page';

describe('web home page', () => {
  it('renders the main marketing headline and primary CTAs', () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain('From issue queue');
    expect(html).toContain('to reviewed PR.');
    expect(html).toContain('View on GitHub');
    expect(html).toContain('Download');
  });

  it('renders the current issue-to-pr positioning copy', () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain('Install in seconds');
    expect(html).toContain('Homebrew for the desktop app.');
  });
});
