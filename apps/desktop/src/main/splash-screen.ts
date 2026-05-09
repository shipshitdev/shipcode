import { BrowserWindow, nativeTheme } from 'electron';
import splashCss from './splash-screen.css?raw';

type SplashStepStatus = 'pending' | 'active' | 'complete' | 'error';

interface SplashStep {
  id: string;
  label: string;
  detail?: string;
  status: SplashStepStatus;
}

const INITIAL_STEPS: SplashStep[] = [
  { id: 'window', label: 'Create app window', status: 'pending' },
  { id: 'database', label: 'Open local database', status: 'pending' },
  { id: 'services', label: 'Start desktop services', status: 'pending' },
  { id: 'pipeline', label: 'Restore pipeline state', status: 'pending' },
  { id: 'ipc', label: 'Register app bridge', status: 'pending' },
  { id: 'renderer', label: 'Load workspace', status: 'pending' },
];

function splashHtml(steps: SplashStep[]): string {
  const initial = JSON.stringify(steps).replace(/</g, '\\u003c');
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';

  return `<!doctype html>
<html data-theme="${theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ShipCode</title>
  <style>${splashCss}</style>
</head>
<body>
  <main>
    <header>
      <div class="mark">SC</div>
      <div>
        <h1>Starting ShipCode</h1>
        <p id="subtitle">Preparing the desktop app.</p>
      </div>
    </header>
    <ol id="steps"></ol>
  </main>
  <script>
    const stepsEl = document.getElementById('steps');
    function escapeText(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    function render(steps) {
      stepsEl.innerHTML = steps.map((step) => '<li class="' + step.status + '"><span class="icon"></span><span class="copy"><span class="label">' + escapeText(step.label) + '</span>' + (step.detail ? '<span class="detail">' + escapeText(step.detail) + '</span>' : '') + '</span></li>').join('');
    }
    window.setShipCodeSplashSteps = render;
    render(${initial});
  </script>
</body>
</html>`;
}

export class SplashScreen {
  private window: BrowserWindow | null = null;
  private steps = INITIAL_STEPS.map((step) => ({ ...step }));
  private loaded = false;

  create(): void {
    if (this.window && !this.window.isDestroyed()) return;

    this.window = new BrowserWindow({
      width: 480,
      height: 430,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      frame: false,
      show: true,
      backgroundColor: '#050607',
      title: 'Starting ShipCode',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.window.once('ready-to-show', () => {
      this.window?.show();
    });
    this.window.webContents.once('did-finish-load', () => {
      this.loaded = true;
      this.flush();
    });
    void this.window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(this.steps))}`,
    );
  }

  update(id: string, status: SplashStepStatus, detail?: string): void {
    this.steps = this.steps.map((step) => {
      if (step.id === id) return { ...step, status, detail };
      if (status === 'active' && step.status === 'pending') return step;
      return step;
    });
    this.flush();
  }

  completeThrough(id: string, detail?: string): void {
    let shouldComplete = true;
    this.steps = this.steps.map((step) => {
      if (!shouldComplete) return step;
      const next = {
        ...step,
        status: 'complete' as SplashStepStatus,
        detail: step.id === id ? detail : step.detail,
      };
      if (step.id === id) shouldComplete = false;
      return next;
    });
    this.flush();
  }

  close(): void {
    const splash = this.window;
    this.window = null;
    if (!splash || splash.isDestroyed()) return;
    splash.close();
  }

  private flush(): void {
    if (!this.loaded || !this.window || this.window.isDestroyed()) return;
    const serialized = JSON.stringify(this.steps).replace(/</g, '\\u003c');
    void this.window.webContents
      .executeJavaScript(`window.setShipCodeSplashSteps(${serialized})`)
      .catch(() => {
        // Best-effort splash updates only.
      });
  }
}
