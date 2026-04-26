'use client';

import { useState } from 'react';

const COMMANDS = {
  desktop: `brew tap shipshitdev/tap\nbrew install --cask shipcode`,
  cli: `npx @shipshitdev/shipcode onboard\nnpx @shipshitdev/shipcode run 42`,
} as const;

type InstallMode = keyof typeof COMMANDS;

const MODE_COPY: Record<InstallMode, { label: string; description: string }> = {
  desktop: {
    label: 'Desktop App',
    description: 'Install the packaged macOS app with Homebrew Cask.',
  },
  cli: {
    label: 'CLI',
    description: 'Run the published CLI through npx without cloning the repo.',
  },
};

export function InstallCommand({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<InstallMode>('desktop');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(COMMANDS[mode]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-lg' : 'max-w-2xl px-6 pb-16'}`}>
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex gap-5">
          {(['desktop', 'cli'] as InstallMode[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={`text-xs font-medium tracking-wide transition-colors ${
                mode === item ? 'text-primary' : 'text-muted hover:text-secondary'
              }`}
            >
              {MODE_COPY[item].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs text-muted transition-colors hover:text-primary"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p className="mb-3 px-1 text-sm text-muted">{MODE_COPY[mode].description}</p>

      <div
        className={`rounded-lg font-mono ${
          compact
            ? 'bg-white/[0.04] px-5 py-4 text-left'
            : 'border border-border bg-secondary px-6 py-4 text-left'
        }`}
      >
        {COMMANDS[mode].split('\n').map((line) => (
          <div key={line} className="flex gap-2 text-[13px] leading-6">
            <span className="select-none text-muted">$</span>
            <span className="text-secondary">{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
