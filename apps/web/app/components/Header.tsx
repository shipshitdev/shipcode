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
      className={`sticky top-0 z-50 transition-colors duration-200 ${
        scrolled ? 'backdrop-blur-lg bg-primary/80' : 'bg-transparent'
      }`}
    >
      <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
        <a href="/" className="text-xl font-bold text-primary">
          ShipCode
        </a>
        <div className="flex items-center gap-6">
          <a href="/docs" className="text-secondary hover:text-primary transition-colors">
            Docs
          </a>
          <a
            href="https://github.com/shipshitdev/shipcode"
            target="_blank"
            rel="noopener noreferrer"
            className="text-secondary hover:text-primary transition-colors"
          >
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}
