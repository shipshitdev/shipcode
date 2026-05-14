import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { CreateTerminalSurfaceOptions, TerminalSurface } from './terminal-surface';

export class XtermSurface implements TerminalSurface {
  private readonly term: Terminal;
  private readonly fitAddon = new FitAddon();

  constructor(options: CreateTerminalSurfaceOptions) {
    this.term = new Terminal({
      disableStdin: !options.interactive,
      convertEol: true,
      scrollback: 5000,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      theme: options.theme,
      cursorBlink: options.interactive,
      cursorStyle: options.interactive ? 'block' : 'underline',
    });
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());
  }

  mount(container: HTMLElement): void {
    this.term.open(container);
  }

  write(data: string): void {
    this.term.write(data);
  }

  onData(handler: (data: string) => void): { dispose(): void } {
    return this.term.onData(handler);
  }

  fit(): void {
    this.fitAddon.fit();
  }

  getSize(): { cols: number; rows: number } {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  setInteractive(enabled: boolean): void {
    this.term.options.disableStdin = !enabled;
    this.term.options.cursorBlink = enabled;
    this.term.options.cursorStyle = enabled ? 'block' : 'underline';
  }

  setTheme(theme: Record<string, string>): void {
    this.term.options.theme = theme;
  }

  dispose(): void {
    this.term.dispose();
  }
}
