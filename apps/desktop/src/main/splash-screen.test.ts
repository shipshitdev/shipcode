import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserWindowInstances, nativeThemeMock } = vi.hoisted(() => ({
  browserWindowInstances: [] as Array<{
    options: unknown;
    destroyed: boolean;
    close: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    webContents: {
      executeJavaScript: ReturnType<typeof vi.fn>;
      once: ReturnType<typeof vi.fn>;
    };
    windowEvents: Map<string, () => void>;
    webContentsEvents: Map<string, () => void>;
  }>,
  nativeThemeMock: {
    shouldUseDarkColors: true,
  },
}));

vi.mock('electron', () => ({
  nativeTheme: nativeThemeMock,
  BrowserWindow: vi.fn(
    class {
      options: unknown;
      destroyed = false;
      close = vi.fn();
      isDestroyed = vi.fn(() => this.destroyed);
      loadURL = vi.fn(async () => undefined);
      show = vi.fn();
      windowEvents = new Map<string, () => void>();
      webContentsEvents = new Map<string, () => void>();
      webContents = {
        executeJavaScript: vi.fn(async () => undefined),
        once: vi.fn((event: string, handler: () => void) => {
          this.webContentsEvents.set(event, handler);
        }),
      };
      once = vi.fn((event: string, handler: () => void) => {
        this.windowEvents.set(event, handler);
      });

      constructor(options: unknown) {
        this.options = options;
        browserWindowInstances.push(this);
      }
    },
  ),
}));

describe('SplashScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserWindowInstances.length = 0;
    nativeThemeMock.shouldUseDarkColors = true;
  });

  it('creates one splash window with themed HTML and reuses it while alive', async () => {
    const { SplashScreen } = await import('./splash-screen');
    const splash = new SplashScreen();

    splash.create();
    splash.create();

    expect(browserWindowInstances).toHaveLength(1);
    expect(browserWindowInstances[0].options).toMatchObject({
      width: 480,
      height: 430,
      frame: false,
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const loadUrl = browserWindowInstances[0].loadURL.mock.calls[0][0] as string;
    const html = decodeURIComponent(loadUrl.replace('data:text/html;charset=utf-8,', ''));
    expect(html).toContain('<html data-theme="dark">');
    expect(html).toContain('Starting ShipCode');
    expect(html).toContain('Create app window');

    browserWindowInstances[0].windowEvents.get('ready-to-show')?.();
    expect(browserWindowInstances[0].show).toHaveBeenCalledTimes(1);
  });

  it('buffers updates until load, flushes escaped step state, and ignores destroyed windows', async () => {
    const { SplashScreen } = await import('./splash-screen');
    const splash = new SplashScreen();
    splash.create();
    const instance = browserWindowInstances[0];

    splash.update('database', 'active', 'Opening <db>');
    expect(instance.webContents.executeJavaScript).not.toHaveBeenCalled();

    instance.webContentsEvents.get('did-finish-load')?.();
    expect(instance.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('Opening \\u003cdb>'),
    );

    splash.completeThrough('services', 'Services ready');
    expect(instance.webContents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('Services ready'),
    );
    expect(instance.webContents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('"database","label":"Open local database","status":"complete"'),
    );

    instance.destroyed = true;
    splash.update('renderer', 'error', 'Renderer failed');
    expect(instance.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('closes live windows and no-ops for missing or destroyed windows', async () => {
    const { SplashScreen } = await import('./splash-screen');
    const splash = new SplashScreen();

    splash.close();
    splash.create();
    const instance = browserWindowInstances[0];
    splash.close();
    splash.close();

    expect(instance.close).toHaveBeenCalledTimes(1);

    splash.create();
    const destroyed = browserWindowInstances[1];
    destroyed.destroyed = true;
    splash.close();
    expect(destroyed.close).not.toHaveBeenCalled();
  });

  it('renders the light theme when the OS theme is light', async () => {
    nativeThemeMock.shouldUseDarkColors = false;
    const { SplashScreen } = await import('./splash-screen');

    new SplashScreen().create();

    const loadUrl = browserWindowInstances[0].loadURL.mock.calls[0][0] as string;
    const html = decodeURIComponent(loadUrl.replace('data:text/html;charset=utf-8,', ''));
    expect(html).toContain('<html data-theme="light">');
  });
});
