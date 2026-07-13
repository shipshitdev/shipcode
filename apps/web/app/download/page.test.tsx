import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DownloadPage from './page';

// Node-env render smoke: the effect (redirect) is exercised via startDownload's
// own unit tests; here we assert the static shell the e2e route-coverage check
// looks for and the releases fallback link.
describe('download page', () => {
  it('renders the preparing-download shell with a releases fallback', () => {
    const html = renderToStaticMarkup(<DownloadPage />);
    expect(html).toContain('Preparing your download');
    expect(html).toContain('view all releases');
    expect(html).toContain('https://github.com/shipshitdev/shipcode/releases');
  });
});
