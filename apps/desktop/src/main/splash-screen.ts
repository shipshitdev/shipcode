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
  const version = app.getVersion();

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
      <div class="mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="40" height="40"><rect width="1024" height="1024" rx="224" ry="224" fill="#0d1117"/><rect x="184" y="192" width="176" height="500" rx="56" ry="56" fill="#45aaf2"/><rect x="424" y="192" width="176" height="560" rx="56" ry="56" fill="#20bf6b"/><rect x="664" y="192" width="176" height="620" rx="56" ry="56" fill="#a55eea"/></svg></div>
      <div>
        <h1>Starting ShipCode</h1>
        <p class="version">v${version}</p>
      </div>
    </header>
    <div class="progress-track"><div class="progress-fill" id="progress" style="width: 0%"></div></div>
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
    var progressEl = document.getElementById('progress');
    var icons = {
      pending: '<svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="7.5" stroke="#52525b" stroke-width="1.5"/></svg>',
      active: '<svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="7.5" stroke="rgba(56,189,248,0.25)" stroke-width="1.5"/><path d="M9 1.5A7.5 7.5 0 0 1 16.5 9" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round"/></svg>',
      complete: '<svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="8.5" fill="#22c55e"/><path d="M5.5 9.5L7.5 11.5L12.5 6.5" stroke="#050607" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      error: '<svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="8.5" fill="rgba(239,68,68,0.18)" stroke="#ef4444" stroke-width="1"/><path d="M6.5 6.5L11.5 11.5M11.5 6.5L6.5 11.5" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></svg>'
    };
    function render(steps) {
      var done = steps.filter(function(s) { return s.status === 'complete'; }).length;
      var pct = Math.round((done / steps.length) * 100);
      progressEl.style.width = pct + '%';
      stepsEl.innerHTML = steps.map(function(step) {
        return '<li class="' + step.status + '"><span class="icon">' + icons[step.status] + '</span><span class="copy"><span class="label">' + escapeText(step.label) + '</span>' + (step.detail ? '<span class="detail">' + escapeText(step.detail) + '</span>' : '') + '</span></li>';
      }).join('');
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
      hasShadow: false,
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
