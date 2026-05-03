import { InstallCommand } from '@/components/InstallCommand';
import { ProductMockup } from '@/components/ProductMockup';

export function Hero() {
  return (
    <section className="px-6 pt-[8vh] pb-16 text-center md:pt-[10vh]">
      <div className="mx-auto max-w-5xl">
        {/* Headline */}
        <div className="animate-fade-in-up">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium tracking-[0.18em] text-secondary uppercase">
            Now in public beta
          </div>
          <h1 className="mx-auto mt-8 max-w-5xl text-3xl font-semibold tracking-[-0.05em] text-primary sm:text-5xl md:text-7xl">
            From issue queue
            <br />
            to reviewed PR.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-secondary md:text-xl">
            AI pipeline that plans, reviews, executes, and verifies — from GitHub issue to merged
            PR.
          </p>
        </div>

        {/* CTAs */}
        <div
          className="animate-fade-in-up mt-10 flex flex-col items-center gap-5"
          style={{ animationDelay: '120ms', animationFillMode: 'both' }}
        >
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href="https://github.com/shipshitdev/shipcode/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#09090b] shadow-[0_0_24px_rgba(255,255,255,0.08)] transition-transform duration-200 hover:scale-[1.03]"
            >
              Download
            </a>
            <a
              href="https://github.com/shipshitdev/shipcode"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 text-sm font-semibold text-primary transition-all duration-200 hover:bg-white/[0.08]"
            >
              View on GitHub
              <span aria-hidden="true">↗</span>
            </a>
            <a
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 text-sm font-semibold text-primary transition-all duration-200 hover:bg-white/[0.08]"
            >
              Read the docs
            </a>
          </div>
          <a
            href="#pipeline"
            className="text-sm text-muted transition-colors duration-200 hover:text-secondary"
          >
            See the pipeline <span aria-hidden="true">↓</span>
          </a>
        </div>

        {/* Product screenshot */}
        <div
          id="pipeline"
          className="animate-screenshot-in mt-14 scroll-mt-8"
          style={{ animationDelay: '200ms', animationFillMode: 'both' }}
        >
          <ProductMockup />
        </div>

        {/* Install section — below the fold */}
        <div
          className="animate-fade-in-up mt-20"
          style={{ animationDelay: '300ms', animationFillMode: 'both' }}
        >
          <h2 className="text-xl font-semibold tracking-tight text-primary sm:text-2xl">
            Install in seconds
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-secondary">
            Install the desktop app with Homebrew or run the same pipeline instantly with{' '}
            <code className="text-muted">npx</code>. Homebrew for the desktop app.
          </p>
          <div className="mt-6">
            <InstallCommand />
          </div>
        </div>
      </div>
    </section>
  );
}
