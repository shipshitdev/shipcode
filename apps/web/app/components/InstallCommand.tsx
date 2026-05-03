'use client';

import { useState } from 'react';

const COMMANDS = {
  desktop: `brew tap shipshitdev/tap
brew install --cask shipcode`,
  cli: `npx @shipshitdev/shipcode onboard
npx @shipshitdev/shipcode run 42`,
} as const;

type InstallMode = keyof typeof COMMANDS;

const MODE_COPY: Record<InstallMode, { label: string; description: string }> = {
  desktop: {
    label: 'Desktop App',
    description: 'Install the desktop app with Homebrew.',
  },
  cli: {
    label: 'CLI',
    description: 'Run the same pipeline instantly with npx.',
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
    <div className={`mx-auto w-full ${compact ? 'max-w-lg' : 'max-w-xl'}`}>
      <div className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.03]">
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
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

        {/* Description */}
        <div className="px-5 pt-3 text-left text-sm text-muted">{MODE_COPY[mode].description}</div>

        {/* Command */}
        <div className="px-5 py-4 text-left font-mono">
          {COMMANDS[mode].split('\n').map((command) => (
            <div key={command} className="flex gap-2 text-[13px] leading-7">
              <span className="select-none text-muted">$</span>
              <span className="text-secondary">{command}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
