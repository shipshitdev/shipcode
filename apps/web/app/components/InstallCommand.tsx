'use client';

import { Button } from '@shipshitdev/ui';
import { useState } from 'react';

const INSTALL_COMMAND = `brew tap shipshitdev/shipcode
brew install --cask shipcode`;

export function InstallCommand({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={compact ? 'flex justify-center' : 'px-6 pb-16 flex justify-center'}>
      <div
        className={`flex items-start gap-4 rounded-lg border font-mono ${
          compact
            ? 'border-white/8 bg-white/[0.03] px-4 py-3 text-xs'
            : 'border-border bg-secondary px-6 py-4 text-sm'
        }`}
      >
        <pre className="m-0 whitespace-pre-wrap text-primary">{INSTALL_COMMAND}</pre>
        <Button variant="secondary" size="xs" onClick={handleCopy} className="ml-2 shrink-0">
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
