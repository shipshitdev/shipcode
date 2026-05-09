import { BrowserWindow, nativeTheme } from 'electron';

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
  <style>
    :root {
      color-scheme: dark;
      --bg: #050607;
      --panel: #0b0d10;
      --border: rgba(255,255,255,0.1);
      --primary: #f4f4f5;
      --secondary: #a1a1aa;
      --muted: #71717a;
      --agent: #38bdf8;
      --success: #22c55e;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-app-region: drag;
    }
    main { width: 420px; padding: 28px; }
    header { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
    .mark {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border: 1px solid rgba(56,189,248,0.35);
      border-radius: 8px;
      background: rgba(56,189,248,0.1);
      color: var(--agent);
      font-weight: 700;
      letter-spacing: 0;
    }
    h1 { margin: 0; font-size: 19px; line-height: 1.2; letter-spacing: 0; }
    p { margin: 4px 0 0; color: var(--secondary); font-size: 13px; }
    ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    li {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 10px;
      align-items: start;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel);
      padding: 10px 12px;
    }
    .label { font-size: 13px; line-height: 18px; font-weight: 600; }
    .detail { margin-top: 1px; color: var(--muted); font-size: 11px; line-height: 15px; }
    .pending .label { color: var(--muted); }
    .active .label { color: var(--agent); }
    .complete .label { color: var(--success); }
    .error .label { color: var(--danger); }
    .icon {
      width: 16px;
      height: 16px;
      margin-top: 1px;
      border-radius: 999px;
      border: 1.5px solid var(--muted);
    }
    .active .icon {
      border-color: rgba(56,189,248,0.25);
      border-top-color: var(--agent);
      animation: spin 0.8s linear infinite;
    }
    .complete .icon {
      border-color: var(--success);
      background: var(--success);
      position: relative;
    }
    .complete .icon::after {
      content: "";
      position: absolute;
      left: 4px;
      top: 2px;
      width: 5px;
      height: 8px;
      border: solid #050607;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .error .icon { border-color: var(--danger); background: rgba(239,68,68,0.18); }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
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
      stepsEl.innerHTML = steps.map((step) => '<li class="' + step.status + '"><span class="icon"></span><span><span class="label">' + escapeText(step.label) + '</span>' + (step.detail ? '<span class="detail">' + escapeText(step.detail) + '</span>' : '') + '</span></li>').join('');
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
