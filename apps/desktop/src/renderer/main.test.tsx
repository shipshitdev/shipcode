// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createRootMock = vi.fn();
const renderMock = vi.fn();

vi.mock('react-dom/client', () => ({
  createRoot: createRootMock,
}));

vi.mock('./App', () => ({
  App: () => <div>App</div>,
}));

vi.mock('@fontsource/dm-sans/400.css', () => ({}));
vi.mock('@fontsource/dm-sans/500.css', () => ({}));
vi.mock('@fontsource/dm-sans/600.css', () => ({}));
vi.mock('./styles/app.css', () => ({}));

describe('renderer entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createRootMock.mockReturnValue({ render: renderMock });
    document.body.innerHTML = '';
  });

  it('mounts the app into the root element', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import('./main');

    expect(createRootMock).toHaveBeenCalledWith(document.getElementById('root'));
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the root element is missing', async () => {
    await expect(import('./main')).rejects.toThrow('Root element not found');
  });
});
