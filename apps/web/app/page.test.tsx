import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('web home page', () => {
  it('renders the main marketing headline and primary CTAs', () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain('Issues in. PRs out.');
    expect(html).toContain('View on GitHub');
    expect(html).toContain('Read the docs');
  });

  it('renders the current issue-to-pr positioning copy', () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain(
      'Plan with Opus, review with Codex, execute in an isolated worktree, and keep verifying until the pull request is ready to land.',
    );
    expect(html).toContain('Planning. Review loops. Worktrees. Verifier retries.');
  });
});
