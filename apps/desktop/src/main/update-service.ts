import type { UpdateStatus } from '@shipcode/shared';
import { app, type BrowserWindow } from 'electron';
import log from './logger.service';

const RELEASES_API_URL = 'https://api.github.com/repos/shipshitdev/shipcode/releases/latest';
const POLL_INTERVAL_MS = 30 * 60_000; // 30 min
const INITIAL_CHECK_DELAY_MS = 5_000; // wait for window before first check

type SemverTuple = [number, number, number, string];

function parseSemver(raw: string): SemverTuple | null {
  const trimmed = raw.trim().replace(/^v/, '');
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''];
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pa[i] as number) - (pb[i] as number);
  }
  // pre-release: missing > present (1.0.0 > 1.0.0-rc)
  if (pa[3] === '' && pb[3] !== '') return 1;
  if (pa[3] !== '' && pb[3] === '') return -1;
  if (pa[3] !== pb[3]) return pa[3] < pb[3] ? -1 : 1;
  return 0;
}

interface GithubReleaseResponse {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

export class UpdateService {
  private mainWindow: BrowserWindow;
  private status: UpdateStatus;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<UpdateStatus> | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.status = {
      current: app.getVersion(),
      latest: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseTag: null,
      publishedAt: null,
      checkedAt: null,
      state: 'idle',
      error: null,
    };
  }

  start(): void {
    setTimeout(() => {
      void this.checkNow();
    }, INITIAL_CHECK_DELAY_MS);
    this.timer = setInterval(() => {
      void this.checkNow();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async checkNow(): Promise<UpdateStatus> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runCheck(): Promise<UpdateStatus> {
    this.update({ state: 'checking', error: null });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(RELEASES_API_URL, {
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'shipcode-desktop',
        },
      }).finally(() => clearTimeout(timeout));

      if (response.status === 404) {
        // Repo has no published stable release yet (pre-release state).
        // Treat as up-to-date rather than surfacing an error to the user.
        this.update({
          latest: null,
          hasUpdate: false,
          releaseUrl: null,
          releaseTag: null,
          publishedAt: null,
          state: 'up-to-date',
          checkedAt: new Date().toISOString(),
          error: null,
        });
        return this.status;
      }

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
      }

      const body = (await response.json()) as GithubReleaseResponse;
      if (body.draft || body.prerelease) {
        // Skip draft/prerelease — only surface stable releases.
        this.update({
          state: 'up-to-date',
          checkedAt: new Date().toISOString(),
          error: null,
        });
        return this.status;
      }

      const tag =
        typeof body.tag_name === 'string'
          ? body.tag_name
          : typeof body.name === 'string'
            ? body.name
            : null;
      if (!tag) throw new Error('Release response missing tag_name');

      const latest = tag.replace(/^v/, '');
      const releaseUrl = typeof body.html_url === 'string' ? body.html_url : null;
      const publishedAt = typeof body.published_at === 'string' ? body.published_at : null;

      const cmp = compareSemver(latest, this.status.current);
      const hasUpdate = cmp > 0;

      this.update({
        latest,
        hasUpdate,
        releaseUrl,
        releaseTag: tag,
        publishedAt,
        checkedAt: new Date().toISOString(),
        state: hasUpdate ? 'available' : 'up-to-date',
        error: null,
      });

      log.info(
        `[update] check complete current=${this.status.current} latest=${latest} hasUpdate=${hasUpdate}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('[update] check failed:', message);
      this.update({
        state: 'error',
        checkedAt: new Date().toISOString(),
        error: message.slice(0, 280),
      });
    }

    return this.status;
  }

  private update(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) return;
    try {
      this.mainWindow.webContents.send('update:status-changed', this.status);
    } catch {
      // window destroyed mid-send
    }
  }
}
