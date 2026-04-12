'use client';

import { Button } from '@shipcode/ui';
import { useState } from 'react';

const INSTALL_COMMAND = 'npx @shipshitdev/shipcode';

export function InstallCommand() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="px-6 pb-16 flex justify-center">
      <div className="bg-secondary border border-border rounded-lg px-6 py-4 flex items-center gap-4 font-mono text-sm">
        <span className="text-muted select-none">$</span>
        <span className="text-primary">{INSTALL_COMMAND}</span>
        <span className="inline-block w-2 h-5 bg-accent animate-[blink_1s_step-end_infinite]" />
        <Button variant="secondary" size="xs" onClick={handleCopy} className="ml-4">
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
    </section>
  );
}
