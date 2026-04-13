export function Footer() {
  return (
    <footer className="px-6 py-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 border-t border-white/8 pt-6 text-sm text-muted">
        <span>© 2026 shipshit.dev</span>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/shipshitdev/shipcode"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-secondary"
          >
            GitHub
          </a>
          <a href="/docs" className="transition-colors hover:text-secondary">
            Docs
          </a>
        </div>
      </div>
    </footer>
  );
}
