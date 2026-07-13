'use client';

import { useEffect, useState } from 'react';
import { RELEASES_URL, startDownload } from './download-logic';

// Static page (the site is a static export): the download itself is resolved
// client-side on load — read the arch from the query string, ask the GitHub API
// for the latest release, and navigate to the matching DMG. All the logic lives
// in ./download-logic (unit-tested); this component is a thin wrapper plus a
// manual fallback link for the rare case the redirect doesn't fire.
export default function DownloadPage() {
  const [manualUrl, setManualUrl] = useState(RELEASES_URL);

  useEffect(() => {
    startDownload(window.location.search, {
      navigate: (url) => window.location.replace(url),
      onResolved: setManualUrl,
    });
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-primary sm:text-3xl">
        Preparing your download…
      </h1>
      <p className="mt-4 max-w-md text-sm leading-6 text-secondary">
        Your ShipCode download should start automatically.
      </p>
      <p className="mt-6 text-sm text-muted">
        Not starting?{' '}
        <a href={manualUrl} className="text-secondary underline hover:text-primary">
          Download manually
        </a>{' '}
        or{' '}
        <a href={RELEASES_URL} className="text-secondary underline hover:text-primary">
          view all releases
        </a>
        .
      </p>
    </main>
  );
}
