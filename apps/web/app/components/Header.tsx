'use client';

import { ShipCodeLogoMark } from '@shipcode/ui';
import Link from 'next/link';
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
      <nav className="mx-auto flex max-w-6xl items-center justify-between p-6">
        <Link
          href="/"
          className="flex items-center gap-3 text-sm font-medium tracking-[0.18em] text-primary uppercase"
        >
          <ShipCodeLogoMark className="size-8 shrink-0" />
          ShipCode
        </Link>
        <div className="flex items-center gap-6 text-sm">
          <Link href="/docs" className="text-secondary transition-colors hover:text-primary">
            Docs
          </Link>
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
