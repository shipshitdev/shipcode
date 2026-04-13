'use client';

import { useEffect, useState } from 'react';

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-primary/70 backdrop-blur-xl' : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <a
          href="/"
          className="flex items-center gap-3 text-sm font-medium tracking-[0.18em] text-primary uppercase"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-xs">
            SC
          </span>
          ShipCode
        </a>
        <div className="flex items-center gap-6 text-sm">
          <a href="/docs" className="text-secondary transition-colors hover:text-primary">
            Docs
          </a>
          <a
            href="https://github.com/shipshitdev/shipcode"
            target="_blank"
            rel="noopener noreferrer"
            className="text-secondary transition-colors hover:text-primary"
          >
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}
