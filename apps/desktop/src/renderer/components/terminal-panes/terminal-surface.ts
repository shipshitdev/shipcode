type TerminalTheme = Record<string, string>;

export interface TerminalSurface {
  mount(container: HTMLElement): void;
  write(data: string): void;
  onData(handler: (data: string) => void): { dispose(): void };
  fit(): void;
  getSize(): { cols: number; rows: number };
  setInteractive(enabled: boolean): void;
  setTheme(theme: TerminalTheme): void;
  dispose(): void;
}

export interface CreateTerminalSurfaceOptions {
  interactive: boolean;
  theme: TerminalTheme;
}
