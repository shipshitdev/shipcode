import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { generateStaticParamsForMock, importPageMock, wrapperMock, mdxContentMock } = vi.hoisted(
  () => ({
    generateStaticParamsForMock: vi.fn(() => () => [{ mdxPath: ['getting-started'] }]),
    importPageMock: vi.fn(),
    wrapperMock: vi.fn(
      ({
        children,
        metadata,
        toc,
      }: {
        children: React.ReactNode;
        metadata: { title: string };
        toc: Array<{ value: string }>;
      }) => (
        <section data-title={metadata.title} data-toc-count={String(toc.length)}>
          {children}
        </section>
      ),
    ),
    mdxContentMock: vi.fn(({ params }: { params: { mdxPath?: string[] } }) => (
      <article>{params.mdxPath?.join('/') ?? 'index'}</article>
    )),
  }),
);

vi.mock('nextra/pages', () => ({
  generateStaticParamsFor: generateStaticParamsForMock,
  importPage: importPageMock,
}));

vi.mock('../../mdx-components', () => ({
  useMDXComponents: () => ({
    wrapper: wrapperMock,
  }),
}));

import CatchAllDocsPage, { generateMetadata, generateStaticParams } from './page';

describe('CatchAllDocsPage', () => {
  it('re-exports the static params generator for mdxPath', () => {
    expect(generateStaticParamsForMock).toHaveBeenCalledWith('mdxPath');
    expect(generateStaticParams()).toEqual([{ mdxPath: ['getting-started'] }]);
  });

  it('loads metadata from the imported MDX page', async () => {
    importPageMock.mockResolvedValueOnce({
      metadata: { title: 'Getting Started' },
    });

    await expect(
      generateMetadata({
        params: Promise.resolve({ mdxPath: ['getting-started'] }),
      }),
    ).resolves.toEqual({ title: 'Getting Started' });
    expect(importPageMock).toHaveBeenCalledWith(['getting-started']);
  });

  it('wraps the MDX content with docs metadata and toc', async () => {
    importPageMock.mockResolvedValueOnce({
      default: mdxContentMock,
      metadata: { title: 'Skills' },
      toc: [{ value: 'Overview' }, { value: 'Usage' }],
    });

    const html = renderToStaticMarkup(
      await CatchAllDocsPage({
        params: Promise.resolve({ mdxPath: ['desktop', 'skills'] }),
      }),
    );

    expect(wrapperMock).toHaveBeenCalledTimes(1);
    expect(mdxContentMock).toHaveBeenCalledWith(
      { params: { mdxPath: ['desktop', 'skills'] } },
      undefined,
    );
    expect(html).toContain('data-title="Skills"');
    expect(html).toContain('data-toc-count="2"');
    expect(html).toContain('desktop/skills');
  });
});
