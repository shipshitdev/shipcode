import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import themeConfig from './theme.config';

describe('docs theme config', () => {
  it('pins the current docs repository metadata', () => {
    expect(themeConfig.docsRepositoryBase).toBe(
      'https://github.com/shipshitdev/shipcode/tree/master/apps/docs',
    );
    expect(themeConfig.editLink).toBe('Edit this page');
    expect(themeConfig.feedback.content).toBe('Question? Give us feedback');
    expect(themeConfig.darkMode).toBe(true);
  });

  it('renders a valid navbar element pointing at the repository', () => {
    expect(isValidElement(themeConfig.navbar)).toBe(true);
    expect(themeConfig.navbar.props.projectLink).toBe('https://github.com/shipshitdev/shipcode');

    const navbarHtml = renderToStaticMarkup(themeConfig.navbar.props.logo);
    expect(navbarHtml).toContain('ShipCode');
    expect(navbarHtml).toContain('src="/logo.svg"');
    expect(navbarHtml).toContain('<img');
  });
});
