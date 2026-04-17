import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { getPageMapMock } = vi.hoisted(() => ({
  getPageMapMock: vi.fn(),
}));

vi.mock('nextra/page-map', () => ({
  getPageMap: getPageMapMock,
}));

vi.mock('nextra-theme-docs', () => ({
  Navbar: ({ logo, projectLink }: { logo: React.ReactNode; projectLink: string }) => (
    <div data-project-link={projectLink}>{logo}</div>
  ),
  Layout: ({
    children,
    pageMap,
    ...props
  }: {
    children: React.ReactNode;
    pageMap: unknown;
    editLink?: string;
  }) => (
    <div data-edit-link={props.editLink} data-page-map={JSON.stringify(pageMap)}>
      {children}
    </div>
  ),
}));

import RootLayout, { metadata } from './layout';

describe('RootLayout', () => {
  it('exports the current docs metadata', () => {
    expect(metadata.title).toEqual({
      default: 'ShipCode Docs',
      template: '%s | ShipCode Docs',
    });
    expect(metadata.description).toBe(
      'Documentation for ShipCode, the autonomous AI coding pipeline.',
    );
  });

  it('renders the docs layout with the fetched page map', async () => {
    getPageMapMock.mockResolvedValueOnce([{ name: 'Getting Started' }]);

    const html = renderToStaticMarkup(
      await RootLayout({
        children: <main>Docs body</main>,
      }),
    );

    expect(getPageMapMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('Docs body');
    expect(html).toContain('data-edit-link="Edit this page"');
    expect(html).toContain('Getting Started');
  });
});
